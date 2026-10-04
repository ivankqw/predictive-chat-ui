"""Choice-only adaptation of upstream's RLCD + cross-entropy training loop.

Notebook source: NandhaKishorM/laya at 6d942c92081fbc139e736bbd9ac0023223c29b7f.
No uploads, paid APIs, or automatic production model changes.
"""

import argparse
from contextlib import nullcontext
import hashlib
import json
import os
from pathlib import Path
import platform
import random
import time

from .data_tools import ROOT, digest, read_rows, verify_splits
from .metrics import report, select_gate
from .policy import LABELS, QUESTIONS

BASE_REPO = "convaiinnovations/laya"
BASE_REVISION = "55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851"
BASE_SHA256 = "891102d372688fc2a094dac56a384bc537b87c63f21f9f3dac0be2b7cbc8d86c"


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2) + "\n")


def new_output(path):
    path = Path(path)
    if path.exists() and any(path.iterdir()):
        raise ValueError(f"Refusing to overwrite existing artifacts: {path}")
    path.mkdir(parents=True, exist_ok=True)
    return path


def collate(items, pad_id):
    import torch
    n, length = len(items), max(len(i["ids"]) for i in items)
    ids = torch.full((n, length), pad_id, dtype=torch.long)
    att = torch.zeros_like(ids)
    positions = torch.zeros((n, len(LABELS)), dtype=torch.long)
    for index, item in enumerate(items):
        ids[index, :len(item["ids"])] = torch.tensor(item["ids"])
        att[index, :len(item["ids"])] = 1
        positions[index] = torch.tensor(item["markers"])
    return {
        "input_ids": ids, "attention_mask": att, "marker_pos": positions,
        "marker_mask": torch.ones_like(positions, dtype=torch.bool),
        "qtype": torch.tensor([i["qtype"] for i in items]),
        "target": torch.tensor([i["target"] for i in items], dtype=torch.float32),
    }


def items_for(rows, tokenizer, cfg):
    from laya.common import QTYPES, build_sequence, encode_text
    q = QUESTIONS["tool_suggestion"]
    internal = {"t": q["type"], "ins": q["instructions"], "crit": q["criteria"]}
    items = []
    for row in rows:
        # Match production's conservative state budget rather than silently truncate drafts.
        tokens = encode_text(tokenizer, row["text"], add_special_tokens=False)["input_ids"]
        if len(tokens) > cfg["max_len"] - cfg["head_max_len"] - 8:
            raise ValueError(f"State exceeds production token budget: {row['id']}")
        ids, markers = build_sequence(tokenizer, row["text"], internal, cfg["max_len"], cfg["head_max_len"])
        if len(markers) != len(LABELS):
            raise ValueError(f"Options truncated: {row['id']}")
        items.append({"ids": ids, "markers": markers, "qtype": QTYPES["choice"],
                      "target": [row["target"][k] for k in LABELS]})
    return items


def load_model(path, device):
    from laya.common import build_model
    from safetensors.torch import load_file
    from transformers import AutoTokenizer
    path = Path(path)
    cfg = json.loads((path / "rl_agent_config.json").read_text())
    tok = AutoTokenizer.from_pretrained(path / "tokenizer", local_files_only=True)
    model = build_model(cfg, encoder_dir=str(path / "encoder"), pretrained=False)
    model.load_state_dict(load_file(str(path / "model.safetensors")), strict=True)
    model.encoder.config.reference_compile = False
    return model.to(device), tok, cfg


def export_model(model, tokenizer, cfg, path):
    from safetensors.torch import save_file
    path = Path(path)
    path.mkdir(parents=True, exist_ok=True)
    save_file({k: v.detach().cpu().contiguous() for k, v in model.state_dict().items()}, str(path / "model.safetensors"))
    model.encoder.config.save_pretrained(path / "encoder")
    tokenizer.save_pretrained(path / "tokenizer")
    write_json(path / "rl_agent_config.json", cfg)
    write_json(path / "artifact.json", {"model_sha256": digest(path / "model.safetensors"),
                                       "config_sha256": digest(path / "rl_agent_config.json")})


def supervised_loss(logits, act, batch):
    import torch
    masked = logits.masked_fill(~batch["marker_mask"], -1e4)
    ce = -(batch["target"] * torch.log_softmax(masked, -1)).sum(-1).mean()
    return ce + 0.0 * act.sum()


def rlcd_loss(logits, act, batch, sigma, generator=None):
    import torch
    from laya.common import proper_reward
    mask, target = batch["marker_mask"], batch["target"]
    k = mask.sum(-1, keepdim=True).float()
    eps = torch.randn((4,) + logits.shape, device=logits.device, generator=generator) * sigma * mask
    eps = (eps - eps.sum(-1, keepdim=True) / k) * mask
    z = logits.detach().unsqueeze(0) + eps
    q = torch.softmax(z.masked_fill(~mask, -1e4), -1)
    with torch.no_grad():
        reward = proper_reward(q, target.unsqueeze(0), batch["qtype"], mask, w_sph=.75, w_rps=1.0)
        advantage = reward - reward.mean(0, keepdim=True)
        advantage = advantage / (advantage.std() + 1e-6)
    logp = -(((z - logits.unsqueeze(0)) ** 2) * mask).sum(-1) / (2 * sigma ** 2)
    return -(advantage * logp).mean() + supervised_loss(logits, act, batch)


def train(args):
    import torch
    import torch.distributed as dist
    from torch.nn.parallel import DistributedDataParallel
    manifest = verify_splits(args.splits)
    objective = getattr(args, "objective", "rlcd")
    if objective not in ("supervised", "rlcd"):
        raise ValueError("Unknown training objective")
    if args.epochs < 1 or args.batch_size < 1 or args.accumulation < 1 or args.max_steps < 0:
        raise ValueError("Training sizes must be positive")
    if not args.allow_fixture and digest(args.model / "model.safetensors") != BASE_SHA256:
        raise ValueError("Training requires the pinned base weight hash; --allow-fixture is only for offline tests")
    distributed = int(os.environ.get("WORLD_SIZE", "1")) > 1
    rank = int(os.environ.get("RANK", "0"))
    if distributed:
        if args.device != "cuda":
            raise ValueError("DDP path requires CUDA")
        dist.init_process_group("nccl")
        device = torch.device("cuda", int(os.environ["LOCAL_RANK"]))
        torch.cuda.set_device(device)
    else:
        device = torch.device(args.device)
    noise_generator = torch.Generator(device=device).manual_seed(42 + rank)
    torch.manual_seed(42)
    random.seed(42)
    output = Path(args.output)
    if rank == 0:
        new_output(output)
    if distributed:
        dist.barrier()
    model, tok, cfg = load_model(args.model, device)
    items = items_for(read_rows(args.splits / "train.jsonl"), tok, cfg)
    # Manifest validation audits all splits; only train rows enter optimization.
    model.encoder.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
    model.head_checkpointing = True
    wrapped = DistributedDataParallel(model, device_ids=[device.index], find_unused_parameters=True) if distributed else model
    optimizer = torch.optim.AdamW([
        {"params": [p for n, p in model.named_parameters() if n.startswith("encoder.")], "lr": 2.5e-5},
        {"params": [p for n, p in model.named_parameters() if not n.startswith("encoder.")], "lr": 1e-4},
    ], weight_decay=.01)
    scaler = torch.amp.GradScaler("cuda", enabled=device.type == "cuda")
    started = time.perf_counter()
    if device.type == "cuda":
        torch.cuda.reset_peak_memory_stats(device)
    steps, history = 0, []
    for epoch in range(args.epochs):
        wrapped.train()
        order = list(range(len(items)))
        random.Random(42 + epoch).shuffle(order)
        # Pad only within train to give DDP equal numbers of backward/collective calls.
        if distributed:
            world = dist.get_world_size()
            order += order[:(-len(order)) % world]
            order = order[rank::world]
        chunks = [order[i:i + args.batch_size] for i in range(0, len(order), args.batch_size)]
        losses = []
        for window in range(0, len(chunks), args.accumulation):
            optimizer.zero_grad(set_to_none=True)
            active = chunks[window:window + args.accumulation]
            sigma = .4 + (.1 - .4) * epoch / max(1, args.epochs - 1)
            for chunk in active:
                batch = {k: v.to(device) for k, v in collate([items[i] for i in chunk], tok.pad_token_id).items()}
                context = torch.autocast("cuda", dtype=torch.float16) if device.type == "cuda" else nullcontext()
                with context:
                    logits, act = wrapped(**{k: v for k, v in batch.items() if k != "target"})
                    if objective == "supervised":
                        loss = supervised_loss(logits.float(), act, batch)
                    else:
                        loss = rlcd_loss(logits.float(), act, batch, sigma, generator=noise_generator)
                if not torch.isfinite(loss):
                    raise ValueError("Non-finite training loss")
                scaler.scale(loss / len(active)).backward()
                losses.append(float(loss.detach().cpu()))
            scaler.unscale_(optimizer)
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            scaler.step(optimizer)
            scaler.update()
            steps += 1
            if args.max_steps and steps >= args.max_steps:
                break
        if rank == 0:
            cfg["fine_tuned"] = True
            cfg["model_name"] = "predictive-workspace-proactive-v1"
            # Explicitly uncalibrated until the separate calibration command completes.
            cfg["temperature"] = [1.0, 1.0, 1.0]
            cfg.pop("temperature_by_options", None)
            cfg.pop("lang_temperatures", None)
            cfg["workspace_training"] = {"seed": 42, "steps": steps, "splits": manifest,
                                         "objective": objective, "noise_rng": "separate-per-rank",
                                         "base_model_sha256": digest(Path(args.model) / "model.safetensors"),
                                         "calibrated": False}
            export_model(model, tok, cfg, output / "checkpoint_latest")
            history.append({"epoch": epoch + 1, "objective": objective, "steps": steps, "mean_loss": sum(losses) / len(losses),
                            "elapsed_seconds": time.perf_counter() - started,
                            "device": str(device),
                            "gpu": torch.cuda.get_device_name(device) if device.type == "cuda" else None,
                            "peak_gpu_allocated_bytes": torch.cuda.max_memory_allocated(device) if device.type == "cuda" else None,
                            "peak_gpu_reserved_bytes": torch.cuda.max_memory_reserved(device) if device.type == "cuda" else None})
            write_json(output / "training.json", history)
            print(json.dumps(history[-1]), flush=True)
        if distributed:
            dist.barrier()
        if args.max_steps and steps >= args.max_steps:
            break
    if distributed:
        dist.destroy_process_group()


def fit_temperature(logits, targets):
    import torch
    from laya.common import TEMP_MAX, TEMP_MIN
    # Fit within the serving loader's supported range, so export cannot silently clamp it.
    # A deterministic grid is stable with this small pilot calibration set.
    temperatures = torch.logspace(torch.log10(torch.tensor(TEMP_MIN)), torch.log10(torch.tensor(TEMP_MAX)), 201)
    losses = torch.stack([-(targets * torch.log_softmax(logits / t, -1)).sum(-1).mean() for t in temperatures])
    return min(TEMP_MAX, max(TEMP_MIN, float(temperatures[losses.argmin()])))


def calibrate(args):
    import torch
    from laya import Agent
    from laya.common import QTYPES
    manifest = verify_splits(args.splits)
    output = new_output(args.output)
    serving = Agent(str(args.model.resolve()), device=args.device)
    if serving.device.type != args.device:
        raise ValueError("Requested calibration device unavailable")
    model, tok, cfg = serving.model, serving.tok, serving.cfg
    if cfg.get("workspace_training", {}).get("splits") != manifest:
        raise ValueError("Checkpoint training split provenance does not match")
    rows = read_rows(args.splits / "calibration.jsonl")
    items = items_for(rows, tok, cfg)
    model.eval()
    logits, targets = [], []
    with torch.no_grad():
        for item in items:
            batch = collate([item], tok.pad_token_id)
            # Use the pinned serving path's autocast rules, not a different training precision.
            z, _ = serving._infer(batch)
            if serving.device.type != args.device:
                raise ValueError("Serving runtime fell back to another device during calibration")
            logits.append(z.float().cpu())
            targets.append(batch["target"].cpu())
    temperature = fit_temperature(torch.cat(logits), torch.cat(targets))
    cfg["temperature"][QTYPES["choice"]] = temperature
    cfg.pop("temperature_by_options", None)
    cfg.pop("lang_temperatures", None)
    cfg["workspace_training"]["calibrated"] = True
    cfg["workspace_calibration"] = {"split_sha256": manifest["files"]["calibration.jsonl"],
                                   "count": len(rows), "choice_temperature": temperature,
                                   "device": str(serving.device), "dtype": str(serving.dtype)}
    export_model(model, tok, cfg, output)
    # Exercise the actual serving loader and ensure probabilities survive export/reload.
    del serving, model
    if args.device == "cuda":
        torch.cuda.empty_cache()
    agent = Agent(str(output.resolve()), device=args.device)
    expected = torch.softmax(logits[0][0] / temperature, -1).tolist()
    actual = agent.system_one(rows[0]["text"], QUESTIONS)["answers"]["tool_suggestion"]["probabilities"]
    # Laya's public answer rounds probabilities to four decimal places.
    if any(abs(actual[k] - round(p, 4)) > 1e-7 for k, p in zip(LABELS, expected)):
        raise ValueError("Calibrated reload probabilities differ")
    print(json.dumps({"temperature": temperature, "reload_probabilities_verified": True}))


def evaluate(args):
    import torch
    from laya import Agent
    from laya.common import encode_text
    if args.select_gate and args.split != "validation":
        raise ValueError("Gates may only be selected on validation")
    manifest = verify_splits(args.splits)
    output = new_output(args.output)
    cfg = json.loads((args.model / "rl_agent_config.json").read_text())
    if "workspace_training" in cfg and not cfg["workspace_training"]["calibrated"]:
        raise ValueError("Calibrate the adapted checkpoint before evaluation")
    if "workspace_training" in cfg and cfg["workspace_training"]["splits"] != manifest:
        raise ValueError("Checkpoint/split mismatch")
    questions = QUESTIONS
    if args.policy == "production":
        from server.decision_provider import QUESTIONS as questions
    agent = Agent(str(args.model.resolve()), device=args.device)
    if agent.device.type != args.device:
        raise ValueError("Requested evaluation device unavailable")
    rows = read_rows(args.splits / f"{args.split}.jsonl")
    predictions = []
    # Warm-up separate from measured inference; load/download time is not latency.
    agent.system_one(rows[0]["text"], questions)
    for row in rows:
        budget = int(cfg["max_len"]) - int(cfg["head_max_len"]) - 8
        if len(encode_text(agent.tok, row["text"], add_special_tokens=False)["input_ids"]) > budget:
            raise ValueError("Evaluation input exceeds production token budget")
        if args.device == "cuda":
            torch.cuda.synchronize()
        started = time.perf_counter()
        answer = agent.system_one(row["text"], questions)["answers"]["tool_suggestion"]
        if agent.device.type != args.device:
            raise ValueError("Serving runtime fell back to another device during evaluation")
        if args.device == "cuda":
            torch.cuda.synchronize()
        predictions.append(dict(row, probabilities={k: float(answer["probabilities"][k]) for k in LABELS},
                                decision_ms=(time.perf_counter() - started) * 1000))
    policy_hash = hashlib.sha256(json.dumps(questions, sort_keys=True).encode()).hexdigest()
    metadata = {"split": args.split, "split_sha256": manifest["files"][f"{args.split}.jsonl"],
                "model_sha256": digest(args.model / "model.safetensors"),
                "config_sha256": digest(args.model / "rl_agent_config.json"),
                "policy": args.policy, "policy_sha256": policy_hash,
                "hardware": {"platform": platform.platform(), "processor": platform.processor(),
                             "device": args.device, "torch_threads": torch.get_num_threads(),
                             "dtype": str(agent.dtype), "amp_enabled": agent.amp_enabled,
                             "gpu": torch.cuda.get_device_name() if args.device == "cuda" else None}}
    if args.select_gate:
        gate = select_gate(predictions, args.split)
        write_json(output / "gate.json", {"gate": gate, "selected_on": metadata})
    elif args.gate:
        payload = json.loads(args.gate.read_text())
        selected = payload["selected_on"]
        if selected["split"] != "validation" or any(selected[k] != metadata[k] for k in ("model_sha256", "config_sha256", "policy_sha256")):
            raise ValueError("Gate must come from validation on this exact model, config and policy")
        if selected["split_sha256"] != manifest["files"]["validation.jsonl"]:
            raise ValueError("Gate validation split changed")
        gate = payload["gate"]
    else:
        gate = {"top": .45, "margin": .15}
    write_json(output / "predictions.json", {"metadata": metadata, "rows": predictions})
    write_json(output / "report.json", {"metadata": metadata, "metrics": report(predictions, gate)})
    print(json.dumps(report(predictions, gate), indent=2))


def fetch_base(args):
    from huggingface_hub import snapshot_download
    source = snapshot_download(BASE_REPO, revision=BASE_REVISION,
                               allow_patterns=["model.safetensors", "rl_agent_config.json", "encoder/*", "tokenizer/*"])
    if digest(Path(source) / "model.safetensors") != BASE_SHA256:
        raise ValueError("Base checkpoint SHA256 mismatch")
    # Do not mutate a shared Hub cache when tokenizer compatibility needs patching.
    import shutil
    from laya.agent import _fix_tokenizer_config
    output = new_output(args.output)
    shutil.copytree(source, output, dirs_exist_ok=True)
    _fix_tokenizer_config(str(output))
    print(str(output.resolve()))


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    fetch = sub.add_parser("fetch-base")
    fetch.add_argument("--output", type=Path, required=True)
    for command in ("train", "calibrate", "evaluate"):
        p = sub.add_parser(command)
        p.add_argument("--model", type=Path, required=True)
        p.add_argument("--splits", type=Path, default=ROOT / "data/splits")
        p.add_argument("--output", type=Path, required=True)
        p.add_argument("--device", choices=("cpu", "cuda"), default="cpu" if command != "train" else "cuda")
        if command == "train":
            p.add_argument("--objective", choices=("supervised", "rlcd"), default="rlcd")
            p.add_argument("--epochs", type=int, default=4)
            p.add_argument("--batch-size", type=int, default=2)
            p.add_argument("--accumulation", type=int, default=4)
            p.add_argument("--max-steps", type=int, default=0)
            p.add_argument("--allow-fixture", action="store_true", help="Test-only bypass of pinned base checksum")
        if command == "evaluate":
            p.add_argument("--split", choices=("validation", "test"), required=True)
            p.add_argument("--policy", choices=("proactive", "production"), default="proactive")
            group = p.add_mutually_exclusive_group()
            group.add_argument("--select-gate", action="store_true")
            group.add_argument("--gate", type=Path)
    args = parser.parse_args()
    {"fetch-base": fetch_base, "train": train, "calibrate": calibrate, "evaluate": evaluate}[args.command](args)


if __name__ == "__main__":
    main()
