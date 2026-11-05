# Research

## Decision: estimate tokens as bytes / 4
Rationale: no tokenizer is available; the estimate errs high for multi-byte text. Alternatives considered: a
model-specific tokenizer (new dependency, executor-specific).

## Decision: bisection over the droppable messages
Rationale: size is monotonic in the number dropped, so it avoids a render per message. Alternatives considered: drop
one at a time (quadratic).
