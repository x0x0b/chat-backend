import express from "express";
import { createServer } from "http";
import { Server, Socket } from "socket.io";
import DOMPurify from "isomorphic-dompurify";


interface ChatMessage {
  id: string;
  text: string;
  timestamp: Date;
  edited?: boolean;
}

interface ServerToClientEvents {
  message: (data: {
    id: string;
    text: string;
    username: string;
    timestamp: Date;
    edited?: boolean;
  }) => void;
  messageDeleted: (messageId: string) => void;
  messageEdited: (data: { id: string; text: string; edited: boolean }) => void;
  userJoined: (data: { username: string; message: string }) => void;
  userLeft: (data: { username: string; message: string }) => void;
  userList: (users: string[]) => void;
  typing: (data: { username: string; isTyping: boolean }) => void;
  error: (message: string) => void;
}

interface ClientToServerEvents {
  join: (username: string) => void;
  message: (data: ChatMessage) => void;
  deleteMessage: (messageId: string) => void;
  editMessage: (data: { id: string; text: string }) => void;
  typing: (isTyping: boolean) => void;
  markAsRead: (messageId: string) => void;
}

const app = express();
const server = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"]
  }
});
const users = new Map<string, string>();
const typingUsers = new Set<string>();

// 接続中のユーザーを定期的にクリーンアップ
setInterval(() => {
  for (const [socketId, username] of users.entries()) {
    const socket = io.sockets.sockets.get(socketId);
    if (!socket?.connected) {
      users.delete(socketId);
      io.emit("userList", Array.from(users.values()));
    }
  }
}, 30000);

io.on(
  "connection",
  (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
    console.log("ユーザーが接続しました");

    socket.on("join", (username: string) => {
      const sanitizedUsername = DOMPurify.sanitize(username);
      users.set(socket.id, sanitizedUsername);
      io.emit("userJoined", {
        username: sanitizedUsername,
        message: `${sanitizedUsername}さんが参加しました`,
      });
      io.emit("userList", Array.from(users.values()));
    });

    socket.on("message", (data: ChatMessage) => {
      try {
        const username = users.get(socket.id);
        if (username) {
          const sanitizedText = DOMPurify.sanitize(data.text);
          io.emit("message", {
            id: data.id,
            text: sanitizedText,
            username,
            timestamp: new Date(),
          });
        }
      } catch (error) {
        socket.emit(
          "error",
          "メッセージの送信に失敗しました。"
        );
      }
    });

    socket.on("deleteMessage", (messageId: string) => {
      io.emit("messageDeleted", messageId);
    });

    socket.on("editMessage", (data) => {
      const sanitizedText = DOMPurify.sanitize(data.text);
      io.emit("messageEdited", {
        id: data.id,
        text: sanitizedText,
        edited: true,
      });
    });

    socket.on("typing", (isTyping: boolean) => {
      const username = users.get(socket.id);
      if (username) {
        if (isTyping) {
          typingUsers.add(username);
        } else {
          typingUsers.delete(username);
        }
        io.emit("typing", { username, isTyping });
      }
    });

    socket.on("disconnect", () => {
      const username = users.get(socket.id);
      if (username) {
        typingUsers.delete(username);
        io.emit("userLeft", {
          username,
          message: `${username}さんが退出しました`,
        });
        users.delete(socket.id);
        io.emit("userList", Array.from(users.values()));
      }
    });
  }
);

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`サーバーが起動しました: http://localhost:${PORT}`);
});
