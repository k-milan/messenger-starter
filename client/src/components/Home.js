import React, { useCallback, useEffect, useState, useContext } from "react";
import axios from "axios";
import { useHistory } from "react-router-dom";
import { Grid, CssBaseline, Button } from "@material-ui/core";
import { makeStyles } from "@material-ui/core/styles";

import { SidebarContainer } from "../components/Sidebar";
import { ActiveChat } from "../components/ActiveChat";
import { SocketContext } from "../context/socket";

const useStyles = makeStyles((theme) => ({
  root: {
    height: "100vh",
  },
}));

const Home = ({ user, logout }) => {
  const history = useHistory();

  const socket = useContext(SocketContext);

  const [conversations, setConversations] = useState([]);
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [activeOtherUserId, setActiveOtherUserId] = useState(null);

  const classes = useStyles();
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  const addSearchedUsers = (users) => {
    const currentUsers = {};

    // make table of current users so we can lookup faster
    conversations.forEach((convo) => {
      currentUsers[convo.otherUser.id] = true;
    });

    const newState = [...conversations];
    users.forEach((user) => {
      // only create a fake convo if we don't already have a convo with this user
      if (!currentUsers[user.id]) {
        let fakeConvo = { otherUser: user, messages: [] };
        newState.push(fakeConvo);
      }
    });

    setConversations(newState);
  };

  const clearSearchedUsers = () => {
    setConversations((prev) => prev.filter((convo) => convo.id));
  };

  const saveMessage = async (body) => {
    const { data } = await axios.post("/api/messages", body);
    return data;
  };

  const sendMessage = (data, body) => {
    socket.emit("new-message", {
      message: data.message,
      recipientId: body.recipientId,
      sender: data.sender,
    });
  };

  const postMessage = async (body) => {
    try {
      const data = await saveMessage(body);

      if (!body.conversationId) {
        addNewConvo(body.recipientId, data.message);
      } else {
        addMessageToConversation(data);
      }

      sendMessage(data, body);
    } catch (error) {
      console.error(error);
    }
  };

  const addNewConvo = useCallback(
    (recipientId, message) => {
      setConversations((prev) =>
        prev.map((convo) => {
          if (convo.otherUser.id !== recipientId) {
            return convo;
          }

          return {
            ...convo,
            id: message.conversationId,
            latestMessageText: message.text,
            messages: [...convo.messages, message],
          };
        })
      );
      setActiveConversationId(message.conversationId);
    },
    [setConversations, setActiveConversationId]
  );

  const markMessageAsRead = useCallback(
    async (conversationId, messageId) => {
      if (!conversationId || !messageId || !user?.id) {
        return;
      }

      if (document.visibilityState !== "visible") {
        return;
      }

      setConversations((prev) =>
        prev.map((convo) =>
          Number(convo.id) === Number(conversationId)
            ? {
                ...convo,
                currentUserLastReadMessageId: messageId,
              }
            : convo
        )
      );

      try {
        await axios.put(`/api/conversations/${conversationId}/read`, {
          messageId,
        });

        socket.emit("conversation-read", {
          conversationId,
          messageId,
          readerId: user.id,
        });
      } catch (error) {
        console.error(error);
      }
    },
    [socket, user?.id]
  );

  const addMessageToConversation = useCallback(
    (data) => {
      // if sender isn't null, that means the message needs to be put in a brand new convo
      const { message, sender = null } = data;

      setConversations((prev) => {
        const existingConvo = prev.find(
          (convo) => convo.id === message.conversationId
        );

        if (!existingConvo && sender !== null) {
          return [
            {
              id: message.conversationId,
              otherUser: sender,
              messages: [message],
              latestMessageText: message.text,
            },
            ...prev,
          ];
        }

        return prev.map((convo) => {
          if (convo.id !== message.conversationId) {
            return convo;
          }

          return {
            ...convo,
            latestMessageText: message.text,
            messages: [...convo.messages, message],
          };
        });
      });

      if (
        Number(message.conversationId) === Number(activeConversationId) &&
        Number(message.senderId) !== Number(user?.id)
      ) {
        markMessageAsRead(message.conversationId, message.id);
      }
    },
    [activeConversationId, markMessageAsRead, setConversations, user?.id]
  );

  const updateOtherUserLastReadMessage = useCallback(
    ({ conversationId, messageId, readerId }) => {
      setConversations((prev) =>
        prev.map((convo) => {
          if (
            Number(convo.id) !== Number(conversationId) ||
            Number(convo.otherUser.id) !== Number(readerId)
          ) {
            return convo;
          }

          return {
            ...convo,
            otherUserLastReadMessageId: messageId,
          };
        })
      );
    },
    [setConversations]
  );

  const markConversationAsRead = useCallback(
    async (conversation) => {
      if (!conversation?.id || !user?.id) {
        return;
      }

      if (document.visibilityState !== "visible") {
        return;
      }

      const latestOtherUserMessage = conversation.messages
        .filter((message) => message.senderId !== user.id)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];

      if (!latestOtherUserMessage) {
        return;
      }

      const currentReadMessage = conversation.messages.find(
        (message) =>
          Number(message.id) === Number(conversation.currentUserLastReadMessageId)
      );

      if (
        currentReadMessage &&
        new Date(currentReadMessage.createdAt) >=
          new Date(latestOtherUserMessage.createdAt)
      ) {
        return;
      }

      markMessageAsRead(conversation.id, latestOtherUserMessage.id);
    },
    [markMessageAsRead, user?.id]
  );

  const setActiveChat = (conversation) => {
    setActiveConversationId(conversation.id || null);
    setActiveOtherUserId(conversation.otherUser.id);
    markConversationAsRead(conversation);
  };

  const addOnlineUser = useCallback((id) => {
    setConversations((prev) =>
      prev.map((convo) => {
        if (convo.otherUser.id === id) {
          const convoCopy = { ...convo };
          convoCopy.otherUser = { ...convoCopy.otherUser, online: true };
          return convoCopy;
        } else {
          return convo;
        }
      })
    );
  }, []);

  const removeOfflineUser = useCallback((id) => {
    setConversations((prev) =>
      prev.map((convo) => {
        if (convo.otherUser.id === id) {
          const convoCopy = { ...convo };
          convoCopy.otherUser = { ...convoCopy.otherUser, online: false };
          return convoCopy;
        } else {
          return convo;
        }
      })
    );
  }, []);

  // Lifecycle

  useEffect(() => {
    // Socket init
    socket.on("add-online-user", addOnlineUser);
    socket.on("remove-offline-user", removeOfflineUser);
    socket.on("new-message", addMessageToConversation);
    socket.on("conversation-read", updateOtherUserLastReadMessage);

    return () => {
      // before the component is destroyed
      // unbind all event handlers used in this component
      socket.off("add-online-user", addOnlineUser);
      socket.off("remove-offline-user", removeOfflineUser);
      socket.off("new-message", addMessageToConversation);
      socket.off("conversation-read", updateOtherUserLastReadMessage);
    };
  }, [
    addMessageToConversation,
    addOnlineUser,
    removeOfflineUser,
    socket,
    updateOtherUserLastReadMessage,
  ]);

  useEffect(() => {
    // when fetching, prevent redirect
    if (user?.isFetching) return;

    if (user && user.id) {
      setIsLoggedIn(true);
    } else {
      // If we were previously logged in, redirect to login instead of register
      if (isLoggedIn) history.push("/login");
      else history.push("/register");
    }
  }, [user, history, isLoggedIn]);

  useEffect(() => {
    setActiveConversationId(null);
    setActiveOtherUserId(null);
  }, [user?.id]);

  useEffect(() => {
    const fetchConversations = async () => {
      try {
        const { data } = await axios.get("/api/conversations");
        setConversations(data);
      } catch (error) {
        console.error(error);
      }
    };
    if (!user.isFetching) {
      fetchConversations();
    }
  }, [user]);

  const handleLogout = async () => {
    if (user && user.id) {
      await logout(user.id);
    }
  };

  return (
    <>
      <Button onClick={handleLogout}>Logout</Button>
      <Grid container component="main" className={classes.root}>
        <CssBaseline />
        <SidebarContainer
          conversations={conversations}
          user={user}
          clearSearchedUsers={clearSearchedUsers}
          addSearchedUsers={addSearchedUsers}
          setActiveChat={setActiveChat}
        />
        <ActiveChat
          activeConversationId={activeConversationId}
          activeOtherUserId={activeOtherUserId}
          conversations={conversations}
          user={user}
          postMessage={postMessage}
        />
      </Grid>
    </>
  );
};

export default Home;
