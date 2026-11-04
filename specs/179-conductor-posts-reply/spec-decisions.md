# Planning decisions

- Keep `conductReply` and post inside its run callback; a new outcome type was rejected as extra code for the same result.
- The conductor appends the marker; asking the model for it was rejected because a lost marker breaks the counters.
