const router = require("express").Router();
const { User, Conversation, Message } = require("../../db/models");
const { Op } = require("sequelize");
const onlineUsers = require("../../onlineUsers");

// get all conversations for a user, include latest message text for preview, and all messages
// include other user model so we have info on username/profile pic (don't include current user info)
router.get("/", async (req, res, next) => {
  try {
    if (!req.user) {
      return res.sendStatus(401);
    }
    const userId = req.user.id;
    const conversations = await Conversation.findAll({
      where: {
        [Op.or]: {
          user1Id: userId,
          user2Id: userId,
        },
      },
      attributes: [
        "id",
        "user1Id",
        "user2Id",
        "user1LastReadMessageId",
        "user2LastReadMessageId",
      ],
      include: [
        { model: Message },
        {
          model: User,
          as: "user1",
          where: {
            id: {
              [Op.not]: userId,
            },
          },
          attributes: ["id", "username", "photoUrl"],
          required: false,
        },
        {
          model: User,
          as: "user2",
          where: {
            id: {
              [Op.not]: userId,
            },
          },
          attributes: ["id", "username", "photoUrl"],
          required: false,
        },
      ],
    });

    for (let i = 0; i < conversations.length; i++) {
      const convo = conversations[i];
      const convoJSON = convo.toJSON();

      // set a property "otherUser" so that frontend will have easier access
      if (convoJSON.user1) {
        convoJSON.otherUser = convoJSON.user1;
        delete convoJSON.user1;
      } else if (convoJSON.user2) {
        convoJSON.otherUser = convoJSON.user2;
        delete convoJSON.user2;
      }

      // set property for online status of the other user
      if (onlineUsers.includes(convoJSON.otherUser.id)) {
        convoJSON.otherUser.online = true;
      } else {
        convoJSON.otherUser.online = false;
      }

      convoJSON.messages.sort(
        (messageA, messageB) =>
          new Date(messageA.createdAt) - new Date(messageB.createdAt)
      );

      // set properties for notification count and latest message preview
      convoJSON.latestMessageText =
        convoJSON.messages[convoJSON.messages.length - 1]?.text;
      convoJSON.currentUserLastReadMessageId =
        convoJSON.user1Id === userId
          ? convoJSON.user1LastReadMessageId
          : convoJSON.user2LastReadMessageId;
      convoJSON.otherUserLastReadMessageId =
        convoJSON.user1Id === userId
          ? convoJSON.user2LastReadMessageId
          : convoJSON.user1LastReadMessageId;
      conversations[i] = convoJSON;
    }

    conversations.sort((convoA, convoB) => {
      const convoALatestMessage = convoA.messages[convoA.messages.length - 1];
      const convoBLatestMessage = convoB.messages[convoB.messages.length - 1];

      return (
        new Date(convoBLatestMessage?.createdAt || 0) -
        new Date(convoALatestMessage?.createdAt || 0)
      );
    });

    res.json(conversations);
  } catch (error) {
    next(error);
  }
});

// idempotently mark the current user's read position in a conversation
router.put("/:conversationId/read", async (req, res, next) => {
  try {
    if (!req.user) {
      return res.sendStatus(401);
    }

    const { conversationId } = req.params;
    const { messageId } = req.body;

    if (!messageId) {
      return res.status(400).json({ error: "messageId is required" });
    }

    const conversation = await Conversation.findByPk(conversationId);

    if (!conversation) {
      return res.sendStatus(404);
    }

    const isConversationUser =
      conversation.user1Id === req.user.id ||
      conversation.user2Id === req.user.id;

    if (!isConversationUser) {
      return res.sendStatus(403);
    }

    const message = await Message.findByPk(messageId);

    if (!message || message.conversationId !== conversation.id) {
      return res.status(400).json({ error: "Message is not in conversation" });
    }

    if (message.senderId === req.user.id) {
      return res
        .status(400)
        .json({ error: "Cannot mark your own message as read" });
    }

    const readField =
      conversation.user1Id === req.user.id
        ? "user1LastReadMessageId"
        : "user2LastReadMessageId";

    const previousReadMessageId = conversation[readField];

    if (previousReadMessageId) {
      const previousReadMessage = await Message.findByPk(previousReadMessageId);

      if (
        previousReadMessage &&
        previousReadMessage.createdAt >= message.createdAt
      ) {
        return res.json({
          conversation,
          updated: false,
          alreadyRead: true,
        });
      }
    }

    conversation[readField] = message.id;
    await conversation.save();

    res.json({ conversation, updated: true, alreadyRead: false });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
