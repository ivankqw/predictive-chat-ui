"""Run the actual pipeline on a tiny random checkpoint, offline; no quality claims."""

import argparse
import json
from pathlib import Path
import subprocess
import sys

from .data_tools import ROOT
from .runtime import export_model


def fixture(path):
    import torch
    from laya.common import DecisionModel
    from tokenizers import Tokenizer
    from tokenizers.models import WordLevel
    from tokenizers.pre_tokenizers import Whitespace
    from transformers import BertConfig, BertModel, PreTrainedTokenizerFast
    torch.manual_seed(42)
    vocab = {word: i for i, word in enumerate(("[PAD]", "[UNK]", "[CLS]", "[SEP]", "[MASK]", "hello"))}
    raw = Tokenizer(WordLevel(vocab, unk_token="[UNK]"))
    raw.pre_tokenizer = Whitespace()
    tokenizer = PreTrainedTokenizerFast(tokenizer_object=raw, pad_token="[PAD]", unk_token="[UNK]",
                                       cls_token="[CLS]", sep_token="[SEP]", mask_token="[MASK]")
    encoder = BertModel(BertConfig(vocab_size=len(vocab), hidden_size=64, num_hidden_layers=1,
                                  num_attention_heads=2, intermediate_size=128, hidden_dropout_prob=0.0,
                                  attention_probs_dropout_prob=0.0))
    model = DecisionModel(encoder, head_layers=1, dropout=0.0)
    cfg = {"encoder": "unused/offline", "head_layers": 1, "act_costs": {"act": 0},
           "max_len": 512, "head_max_len": 192, "temperature": [1.0, 1.0, 1.0],
           "temperature_by_options": {"choice:3-5": 2.0}}
    export_model(model, tokenizer, cfg, path)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.output.exists():
        raise ValueError("Smoke output must be a new directory")
    args.output.mkdir(parents=True)
    fixture(args.output / "fixture")
    base = [sys.executable, "-m", "finetune.runtime"]
    commands = [
        ["train", "--model", str(args.output / "fixture"), "--output", str(args.output / "train"),
         "--device", "cpu", "--epochs", "1", "--max-steps", "1", "--allow-fixture"],
        ["calibrate", "--model", str(args.output / "train/checkpoint_latest"),
         "--output", str(args.output / "calibrated")],
        ["evaluate", "--model", str(args.output / "calibrated"), "--split", "validation", "--select-gate",
         "--output", str(args.output / "validation")],
        ["evaluate", "--model", str(args.output / "calibrated"), "--split", "test",
         "--gate", str(args.output / "validation/gate.json"), "--output", str(args.output / "test")],
    ]
    for command in commands:
        subprocess.run(base + command, check=True, cwd=ROOT.parent)
    report = json.loads((args.output / "test/report.json").read_text())
    manifest = json.loads((ROOT / "data/splits/manifest.json").read_text())
    if report["metrics"]["count"] != manifest["counts"]["test"]:
        raise ValueError("Unexpected test count")
    print("PASS: offline random-fixture train/calibrate/reload/validation-gate/test pipeline; not model quality evidence")


if __name__ == "__main__":
    main()
