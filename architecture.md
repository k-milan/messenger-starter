# Webhook Ingestion Architecture

This document details the webhook ingestion architecture that we will be using for Hair Clubs.

## Requirements
---
- Zero data loss 
- Exactly once processing (each event handled exactly once, even if Meta retries delivery) 
- Outbound API calls back to Meta (to fetch additional data) must respect Meta's rate limits 
- The system needs to gracefully handle Meta being temporarily down 
- We need to know if processing falls behind so we can intervene 

## Components and Data Flow

```text
Meta Webhook
     |
     v
Webhook API
  - validate signature
  - store raw event
         w/ processing details
  - dedupe by event id
     |
     v
Postgres: webhook_events (which includes processing details like processed, failed, etc.)
     |
     v
RabbitMQ: event_processing_queue
     |
     v
Celery Worker Pool
  - claim event
  - call to meta if needed
  - apply business logic
  - mark processed
     |
     v
Postgres: webhook_event processed data / status updates

------

Celery Worker Pool
     |
     v
Meta API
  - rate limited calls
  - retries with backoff
```

For retrying jobs:

```text
Worker failure
     |
     v
Delayed Retry (backoff)
     |
     v
Worker retries but still fails after `n` tries
     |
     v
Dead letter Queue
```

## Storage choices

App Database
- Stores the webhook events + processing details
- Each of the webhook events must be uniquely identifiable using meta's generated webhook id for idempotence
- Must store the processing details of each webhook. If the webhook has succeeded, or failed

Queue
- A job queue
     Stores jobs that have yet to be worked on
- A dead letter queue
     Stores jobs that have failed after max retries
- A retry queue
     For jobs that have failed but have yet to hit max retries while waiting for backoff

We need the queue for two things:
- To control how much we hit the meta API. We should be able to control how much we hit our vendors so we don't hit the rate limits. Queues allow us to manage how often we hit the api.
- To avoid losing work after ingestion. The database is the source of truth for zero data loss; the queue lets us retry and process asynchronously.

Cache
- We'll need a cache layer to cache our responses from meta, especially when we expect them to be the same.
- For example, when we're expecting to fetch a parent object's details from multiple children, we'd want to cache that so we wont hit the API unnecessarily.
- For retries, this might also be a good idea because failures might happen after fetching more information about a webhook event, like post details. If we store that, we can just use the cache when retrying instead of calling the meta api again, which contributes to rate limits.

## Idempotency, Deduplication, Storage, and Failure modes

Storing webhook events to the database immediately before acknowledging to meta that we have received it allows us to make events idempotent. Deduplication happens at the database insert, if we receive the same event, we can check the database and deduplicate these events. Adding a unique constraint in the webhook_id, or simply using the webhook_id as a primary key would enforce another layer of dedupliation. If the insert succeeds, its the first time we received this data and we can give acknowledgement to meta. If it fails, we can ackonwledge we received the data without adding it to the queue. Simple storage can help us stop redundant processing.

For our failure modes:
1. Duplicate webhook delivery
We can receive multiple of the same event, or meta could send them multiple times, but if we've successfully added that to the database, we can be sure to not process it again.

2. API crashes before storing the event
In this scenario, the API tries as much as possible to store it to the database first for minimal failure scenarios between reception and persistence. In the case where we can't observability helps here because we can know when this fails, and we can log the payload. If it still fails before logging, we rely on meta to retry since the event failed to be acknowledged by our webhook.

3. API stores the event but fails to enqueue
We store event status to the database, so we'd know if it was ingested but not queued. A reconciler can periodically scan `received` events that were not queued and enqueue them. We can take the right action based on this.

4. Worker crashes while processing
Similar to 3, the event status is persisted in the database. If the worker crashes, we can either retry it or enqueue it again.

5. Worker processes, but crashes before marking the event as processed
It can be retried, our cache layers will work here because we'd have cached our meta calls. Even if this was not something we'd cached, a retry should be possible here. Writes should be made idempotent as well by using keyed upserts/inserts. That way we won't have multiple rows inserted to the database.

6. Meta API is down or rate limited
The worker attempts normally with exponential backoff and max retries. Jobs are moved to dead letter queue after max retries for processing again later. Ideally we'd pause processing job in the queue while we periodically poke the meta api with either health endpoints or lightweight apis to check. Once up again, we start working on the jobs.

7. Invalid payloads
Workers will retry this normally, and sent to the dead letter queue. Notes on why it failed should also be there.

The webhook events should have these following statuses:
- received
- queued
- processing
- processed
- failed

While the webhook_events table should also store the following:
- number of attempts
- next retry
- last error
- payload
- meta unique id
- processed timestamp

## Burst scenario without losing events

The webhook only ingests, persists, enqueues, and then acknowledges. The webhook must never process anything else. Bursts won't affect the webhook because the API should be able to scale with traffic, and offloading heavy jobs to the queue helps keep the webhook available as much as possible. 

The queue is the most critical part, since it absorbs the burst traffic. We can scale the queue as much as we want, while making sure that rate limits won't get hit. 

Since the webhook only ingests and persists, we won't have that much data loss, so we'll guarantee a very high rate of webhook persistence. Observability helps us with events that fail in this critical part because we can log the event payload in case it fails between reception and persistence.

## Handle meta being down for 30 minutes

The best way to do this is to stop queue processing when we detect that meta is down. We'll make sure to continue poking the api with health checks or lightweight apis to see if its still down. Once up, we will continue with processing the jobs in the queue.

## Observability Strategy

We will observe the following metrics:
- Events received per second: Average and Peak
- Heatmap of times where we're most busy
- Logging to a platform like Sentry all expected failure points + unhandled exceptions with payload, reason, and stack trace
- How many jobs are currently queued and not processed to see bottleneck
- Events failed per second: Average and peak
- Failure sorted by event type
- Queue job count per queue
- Oldest job age / queue lag
- Dead letter queue count
- Meta API rate-limit responses / error rates

With these observability strategies, we can safely cover all of our vulnerabilities and also study certain trends in our webhook ingestion. How often meta fails, how often do our jobs fail, what kinds of jobs fail the most, and all of the other metrics help us shift our strategy in the long run to cover for our weaknesses.

## What you'd build differently if volume was 100x larger

A more aggressive load balancer and horizontal scaling would be necessary.
More instances to receive the data would be beneficial so we can keep receiving data, and since webhook ingestion is lightweight, that helps us keep instances free fast.

More queue topics would also be beneficial here. Since different meta apis will have different rate limits, we can move each api type to its own queue that way we can run multiple calls at the same time.
More queues at the processing level would also be beneficial. From ingestion, deduplication, hitting meta's endpoints, processing and persistence can be done in multiple queues so we can keep queues lightweight and we'd have less bottleneck per queue.

An optimization in the database layer is also beneficial, we can partition the database (assuming we'd have millions of rows in the webhook events alone) so overhead when querying the database remains small. This would also help us with cleanup later on when needed.

At 100x volume, I would consider Kafka because webhook events become a durable event stream. Kafka gives us partitioning, replay, retention, and consumer lag tracking.
