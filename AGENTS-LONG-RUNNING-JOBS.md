# Monitoring Long-Running Data Processing

Apply these rules to downloads and bulk data processing. They do not apply to development, builds, or deployment.

For processing that takes longer than five minutes, measure completed and remaining volume, speed, successes and
errors, occupied and available concurrency slots, stage durations, and the cost of paid requests.
Every two minutes, or at the interval specified by the user, report the measurement time, changes in metrics,
cost so far and estimated total cost, stage progress, difficulties, and estimated completion time.
Base forecasts on several measurements. If speed is unstable, explain the lack of data rather than inventing a deadline.

## Stopping Unproductive Retries

Stop the current approach and investigate if:

- Two consecutive checks show no progress.
- Speed is half the rate needed to meet the deadline or lower.
- The same error or unavailability occurs three times.
- A restart is attempted without addressing the cause.
- A stage's cost or duration is disproportionate to its result.
- Part of the processing remains unchanged when it should be advancing.

Stop identical retries and new paid requests. Find the cause using logs, queues, and stage durations.
Fix the cause or choose a faster approach with the same result, then recalculate the forecast.
If access or a user decision is needed, immediately state the blocker, required action, and consequences of waiting.
Do not conceal a stop behind messages claiming that work is continuing.
