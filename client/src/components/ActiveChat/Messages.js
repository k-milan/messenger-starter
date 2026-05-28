import React from "react";
import { Box } from "@material-ui/core";
import { makeStyles } from "@material-ui/core/styles";
import { SenderBubble, OtherUserBubble } from ".";
import moment from "moment";

const useStyles = makeStyles(() => ({
  root: {
    flexGrow: 1,
    minHeight: 0,
    overflowY: "auto",
    paddingTop: 24,
    paddingBottom: 24,
  },
}));

const Messages = (props) => {
  const classes = useStyles();
  const { messages, otherUser, userId, otherUserLastReadMessageId } = props;

  return (
    <Box className={classes.root}>
      {messages.map((message) => {
        const time = moment(message.createdAt).format("h:mm");

        return message.senderId === userId ? (
          <SenderBubble
            key={message.id}
            text={message.text}
            time={time}
            otherUser={otherUser}
            showReadAvatar={
              Number(message.id) === Number(otherUserLastReadMessageId)
            }
          />
        ) : (
          <OtherUserBubble
            key={message.id}
            text={message.text}
            time={time}
            otherUser={otherUser}
          />
        );
      })}
    </Box>
  );
};

export default Messages;
