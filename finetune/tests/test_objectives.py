import torch

from finetune.runtime import rlcd_loss, supervised_loss


def batch():
    return {"marker_mask": torch.tensor([[True, True, False]]),
            "target": torch.tensor([[0., 1., 0.]]), "qtype": torch.tensor([0])}


def test_supervised_gradient_rewards_target_and_ignores_masked_option():
    logits = torch.tensor([[2., -1., 100.]], requires_grad=True)
    act = torch.tensor([1.], requires_grad=True)
    state = torch.random.get_rng_state().clone()
    loss = supervised_loss(logits, act, batch())
    loss.backward()
    assert torch.equal(state, torch.random.get_rng_state())
    assert logits.grad[0, 0] > 0
    assert logits.grad[0, 1] < 0
    assert logits.grad[0, 2] == 0
    assert act.grad.item() == 0
    improved = logits.detach() - .1 * logits.grad
    assert supervised_loss(improved, act, batch()) < loss


def test_rlcd_noise_isolated_and_reproducible():
    logits = torch.tensor([[2., -1., 100.]], requires_grad=True)
    act = torch.tensor([1.], requires_grad=True)
    torch.manual_seed(95)
    before = torch.random.get_rng_state().clone()
    first = rlcd_loss(logits, act, batch(), .4, generator=torch.Generator().manual_seed(42))
    first.backward()
    first_gradient = logits.grad.clone()
    assert torch.equal(before, torch.random.get_rng_state())
    logits.grad = None
    second = rlcd_loss(logits, act, batch(), .4, generator=torch.Generator().manual_seed(42))
    second.backward()
    assert torch.equal(first, second)
    assert torch.equal(first_gradient, logits.grad)
    assert torch.isfinite(logits.grad).all()
    assert logits.grad[0, 2] == 0
    logits.grad = None
    supervised_loss(logits, act, batch()).backward()
    assert not torch.allclose(first_gradient, logits.grad)


def test_temperature_never_rounds_outside_serving_bounds():
    from laya.common import TEMP_MIN, TEMP_MAX
    from finetune.runtime import fit_temperature
    temperature = fit_temperature(torch.tensor([[1., 0.]]), torch.tensor([[1., 0.]]))
    assert TEMP_MIN <= temperature <= TEMP_MAX
