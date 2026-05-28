# Bug Fix

I will be detailing both bugs and how I fixed them in this document. The format is as follows: 

- Initial assumptions 
  are going to be my first assumptions on what is happening without having read the code yet.
- Investigation
  Live investigation notes and things I'm doing while investigating and fixing.

## Bug 1 - Chat messages aren't appearing on screen

### Initial Assumptions

---

I'm thinking this lacks optimistic updates. We're sending it to the server and persisting to the db but the UI is not optimistically updated.
First thing to check is the function to send and what happens there.

### Investigation

---

I need to find the method that sends the message. I checked the `handleSubmit()` method in `/client/src/components/ActiveChat/Input.js`, and my assumption is half correct.

First, `postMessage` calls `saveMessage`, an async method, but we aren't awaiting it. We need to fix that.

Next, Optimistic updates are being "done" but there is a problem with how this is implemented.

For context:
Home.js > ActiveChat.js > Input.js is the branch in the DOM Tree that handles the saving.
`postMessage()` is prop drilled from home to input and is called in `handleSubmit()`.

in `Home.js postMessage()`, we are calling `addMessageToConversation` which is a `useCallback` that simply does a `forEach` on `conversations`. Directly editing the `conversations` state array will not do anything since react doesn't detect changes to the reference. We need to use the `setConversations` with a new array or object reference so react detects the state change.

I'm seeing that `addNewConvo()` also does the same thing, so I'm fixing this as well. 

Checking further, `addMessageToConversation` is also called when we receive a message from the other user, so fixing `addMessageToConversation` fixes both sending and receiving. 

Using Codex to double check if i'm missing something.

### Solution:

---

Fix the mutation of the `conversations` state in `Home.js`. Previously `addNewConvo` and `addMessageToConversation` only used `conversations.forEach` which changes the current state, but react won't detect changes to that. Instead we changed it to `setConversations((prev) => {...})` to properly update state.

To answer each question in the file:

1. How I diagnosed this bug:

I assumed something was wrong with optimistic updates, or maybe updating the messages in general. So i traced what we call when a message is submitted. I reached `Home.js` and the `postMessage` method in that file. There i saw that `addMessageToConversation` and `addNewConvo` were mutating the `conversations` array directly and that `saveMessage` was an async method we were calling without awaiting.

1. What tools I used:

This was simple enough for me to diagnose by myself quickly so I only used Codex to double check and confirm if I'm missing something after I fixed the error and tested it out.

1. What the root cause was:

Biggest issue: mutating `conversations` without using `setConversations`. 
Second issue: calling `saveMessage` without awaiting it. 

## Bug 2 - Messages display order is wrong

### Initial Assumption

---

On page load, messages are ordered latest at the top, oldest at the bottom. When we receive and send a message, they are appended correctly at the bottom. This is either a bug on the server side ordering, or client side display inversion. Either way I'll be checking both. 

### Investigation

---

I'll start investigating the server to see if we are ordering it there.

Checking `server/routes/api/conversations.js`, we can see that the model message is included and ordered in DESCENDING order using the `createdAt` field. This is normally a correct mental model because if we paginate the data later on, we want to fetch the latest first, reverse the list in the frontend, and then when we scroll up we fetch the next older messages.

However since this task is time-bound and making the chat screen only load when needed is not part of the scope, we'll stick with fixing this.

So the current descending order sorts the messages latest first and that's what we display in the frontend since `Home.js` doesn't do any re-ordering, or inversion of arrays.

Current ordering:

```
latest
latest 2
...
oldest
```

We need to make it so that the list returns:

```
oldest
...
latest 2
latest
```

So we need to change it to `ASC` instead of `DESC`. I'm changing the include level message order to `ASC`. That didn't work. I'm checking, why and I see that the top level order is also ordering message in descending order. 

I consult Codex here and they say include level orders aren't reliable. I double check with google and find multiple sources in Medium and StackOverflow talking about using top level orders instead. I change the top level order to Ascending and this works.

Next problem, the preview for the latest message is now using the first message. Initial assumption again is that it gets the first message of the list as the "latest message" because that's where the latest message was initially located. We need to change it to point to the end of the array.

I find for references of `latestMessageText` in both frontend and backend. The api actually sets this before returning the full json and it uses the first message: `convoJSON.latestMessageText = convoJSON.messages[0].text`

I check frontend to be sure as well, but all i see are lines that change the current latestMessageText to the recently added message to the conversation. Which is correct.

So I need to change `convoJSON.messages[0].text` to take the length - 1 instead of 0.

## Solution:

---

Fix the backend ordering of the messages from Descending order to Ascending order. This fixed the display issue. This causes another issue which is the latest message was always assumed to be the first one in the array. Since the order is flipped, we need to get the last message in the array instead of the first.

1. How I diagnosed this bug:

I had an assumption of it being cased by either backend using the wrong order, or frontend flipping the order. I checked the API to see if the ordering was wrong and it sure was. 

To note: It would be correct to use DESC if we flipped it in the frontend, and wanted to implement a paginated scrolling list that only loads a few messages at a time, but that is out of scope for now.

1. What tools I used:

Asked codex and google why changing the include-level order didn't work. Otherwise this was simple enough to do on my own. 

1. What the root cause

the API was ordering the messages in Descending order which meant first message that is displayed is the latest, instead of the oldest.