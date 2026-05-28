# Read Messages

This document details decisions, thoughts, and trade-offs when implementing the Read status for messages.

## Database design
---
There are a few ways to do this that come to mind immediately. Let's go through them one-by-one.

### Option 1
```
messages
- read: boolean
```

**Benefits:**
This is the easiest to implement. Everything starts at false, if read, we flip the boolean to true.
We're able to show read status immediately with this, no complications.

**Drawbacks:**
The drawback here is that we're not able to see timestamps when we want to.
Another is this being limited to only private messaging. Group chats won't benefit from this.
Multiple message rows will need to be updated when we read

### Option 2
```
messages
- read: date
```

**Benefits:**
This is a more robust solution since we can also show when he user was able to view the message.
However, I don't think we have any need to display seen-time. Specifications only show being able to know if the message was read or not.

**Drawbacks:**
The drawback here is that it's very limited only to private messaging like option 1.
Multiple message rows will need to be updated when we read

### Option 3
```
message_reads
- messageId: message ID
- userId: user's ID
- readAt: date/bool
```

**Benefits:**
This is a very future-proof way to implement reads, especially if we see ourselves opening up group chat features in the future. 
This might be the most robust way to deal with reads in a chatting system.

**Drawbacks:**
The drawback here is that it will take way longer to implement. 
It's robustness is also it's drawback for this current system because it's simply unnecessary to have this for a system that only provides private messaging.

### Option 4
```
conversations
- user1LastReadMessageId
- user2LastReadMessageId
```

This is a conversations level approach. Every read, we'd need to update conversations.

**Benefits:**
In terms of space, this might be a better approach compared to message level fields because we're only storing a few bytes per conversation.
Frontend will be easy to implement (`message.id === user1LastReadMessageId`)
Allows us to update only 1 row, the conversation, instead of multiple in the case of message-level fields.

**Drawbacks:**
This also removes the ability to know when we read each message, which message-level fields and separate message_reads table offers.
When extending to group-chat, and eventually creating message_reads, we lose the ability to add time-based information if needed.
A lot of application-layer safeguards are needed to make sure the ids stored are from this conversation, or is the correct Id that was read. Theoretically, we could send a wrong ID here, and while easily preventable, is still an unnecessary risk to take.

### Decision
---
**Option 4 - Conversation level fields**

I eliminated Option 3 immediately due to the complexity. This level of complexity is unnecessary for a one 

It was difficult to argue between Option 2 and Option 4.
Option 2 seems like the cleanest database-level way for us to do reads. And this is true because having datetimes in each message row is intuitively a better design.

However, option 4 allows us to make this feature come to life immediately. 

To break it down this is the metrics i decided on:

