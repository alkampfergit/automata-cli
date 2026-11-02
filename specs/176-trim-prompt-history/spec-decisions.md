# Planning decisions

- Token estimate is bytes / 4: no tokenizer is available; alternative, a tokenizer dependency, was rejected.
- Bisection finds the number of messages to drop; alternative, one by one, was rejected as quadratic.
- No separate byte limit: stdin removed the argument limit (#164).
