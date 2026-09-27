package com.tetris.game;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadLocalRandom;

@Component
public class BattleHandler extends TextWebSocketHandler {

    private static final Set<String> DIFFICULTIES = Set.of("easy", "normal", "hard", "master");

    private final ObjectMapper mapper = new ObjectMapper();
    private final Map<String, Room> rooms = new ConcurrentHashMap<>();
    private final Map<String, String> sessionRooms = new ConcurrentHashMap<>();

    @Override
    public void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        JsonNode node;
        try {
            node = mapper.readTree(message.getPayload());
        } catch (Exception ex) {
            send(session, Map.of("type", "error", "message", "메시지를 이해하지 못했어요."));
            return;
        }
        String type = text(node, "type");
        switch (type) {
            case "create" -> createRoom(session, node);
            case "join" -> joinRoom(session, node);
            case "attack" -> relayAttack(session, node);
            case "lose" -> declareLoss(session);
            case "rematch" -> requestRematch(session);
            default -> send(session, Map.of("type", "error", "message", "알 수 없는 요청이에요."));
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        leave(session);
    }

    public List<Map<String, String>> listWaiting() {
        List<Map<String, String>> waiting = new ArrayList<>();
        for (Room room : rooms.values()) {
            if (room.guest == null && room.host != null && room.host.session.isOpen() && !room.started) {
                waiting.add(Map.of(
                        "code", room.code,
                        "hostName", room.host.name,
                        "createdAt", room.createdAt.toString()
                ));
            }
        }
        waiting.sort(Comparator.comparing(room -> room.get("createdAt")));
        return waiting;
    }

    private void createRoom(WebSocketSession session, JsonNode node) {
        leave(session);
        String name = cleanName(text(node, "name"));
        if (name.isEmpty()) {
            send(session, Map.of("type", "error", "message", "이름을 알려주세요!"));
            return;
        }
        String difficulty = text(node, "difficulty");
        if (!DIFFICULTIES.contains(difficulty)) {
            difficulty = "normal";
        }
        String code = newCode();
        Room room = new Room(code, difficulty, new Player(session, name));
        rooms.put(code, room);
        sessionRooms.put(session.getId(), code);
        send(session, Map.of("type", "waiting", "code", code));
    }

    private void joinRoom(WebSocketSession session, JsonNode node) {
        leave(session);
        String name = cleanName(text(node, "name"));
        String code = text(node, "code").replaceAll("\\D", "");
        if (name.isEmpty()) {
            send(session, Map.of("type", "error", "message", "이름을 알려주세요!"));
            return;
        }
        if (code.length() != 4) {
            send(session, Map.of("type", "error", "message", "방 번호 4자리를 입력해 주세요."));
            return;
        }
        Room room = rooms.get(code);
        if (room == null || room.host == null || !room.host.session.isOpen()) {
            send(session, Map.of("type", "error", "message", "그 방 번호는 없어요."));
            return;
        }
        if (room.guest != null) {
            send(session, Map.of("type", "error", "message", "이미 친구가 들어온 방이에요."));
            return;
        }
        room.guest = new Player(session, name);
        sessionRooms.put(session.getId(), code);
        begin(room);
    }

    private void relayAttack(WebSocketSession session, JsonNode node) {
        Room room = roomOf(session);
        if (room == null || !room.started) {
            return;
        }
        int lines = node.path("lines").asInt(0);
        if (lines < 1 || lines > 4) {
            return;
        }
        Player other = other(room, session);
        if (other != null) {
            send(other.session, Map.of("type", "attack", "lines", lines));
        }
    }

    private void declareLoss(WebSocketSession session) {
        Room room = roomOf(session);
        if (room == null || !room.started) {
            return;
        }
        Player other = other(room, session);
        room.started = false;
        if (other != null) {
            send(other.session, Map.of("type", "win", "reason", "topout"));
        }
    }

    private void requestRematch(WebSocketSession session) {
        Room room = roomOf(session);
        if (room == null || room.guest == null) {
            return;
        }
        if (room.host.session.getId().equals(session.getId())) {
            room.hostRematch = true;
        } else if (room.guest.session.getId().equals(session.getId())) {
            room.guestRematch = true;
        } else {
            return;
        }
        Player other = other(room, session);
        if (other != null && !(room.hostRematch && room.guestRematch)) {
            send(other.session, Map.of("type", "rematchAsk"));
            send(session, Map.of("type", "rematchWait"));
        }
        if (room.hostRematch && room.guestRematch) {
            begin(room);
        }
    }

    private void begin(Room room) {
        int seed = ThreadLocalRandom.current().nextInt(1, Integer.MAX_VALUE);
        room.started = true;
        room.hostRematch = false;
        room.guestRematch = false;
        send(room.host.session, Map.of(
                "type", "start",
                "seed", seed,
                "difficulty", room.difficulty,
                "opponent", room.guest.name
        ));
        send(room.guest.session, Map.of(
                "type", "start",
                "seed", seed,
                "difficulty", room.difficulty,
                "opponent", room.host.name
        ));
    }

    private void leave(WebSocketSession session) {
        String code = sessionRooms.remove(session.getId());
        if (code == null) {
            return;
        }
        Room room = rooms.get(code);
        if (room == null) {
            return;
        }
        boolean hostLeft = room.host != null && room.host.session.getId().equals(session.getId());
        if (hostLeft) {
            if (room.guest != null && room.guest.session.isOpen()) {
                send(room.guest.session, Map.of(
                        "type", room.started ? "win" : "error",
                        "reason", "leave",
                        "message", "친구가 나갔어요."
                ));
                sessionRooms.remove(room.guest.session.getId());
            }
            rooms.remove(code);
            return;
        }
        if (room.guest != null && room.guest.session.getId().equals(session.getId())) {
            room.guest = null;
            room.guestRematch = false;
            if (room.started) {
                room.started = false;
                send(room.host.session, Map.of("type", "win", "reason", "leave"));
            } else {
                send(room.host.session, Map.of("type", "waiting", "code", room.code));
            }
        }
    }

    private Room roomOf(WebSocketSession session) {
        String code = sessionRooms.get(session.getId());
        return code == null ? null : rooms.get(code);
    }

    private Player other(Room room, WebSocketSession session) {
        if (room.host != null && room.host.session.getId().equals(session.getId())) {
            return room.guest;
        }
        return room.host;
    }

    private String newCode() {
        for (int i = 0; i < 20; i++) {
            String code = String.format("%04d", ThreadLocalRandom.current().nextInt(10000));
            if (!rooms.containsKey(code)) {
                return code;
            }
        }
        return String.format("%04d", ThreadLocalRandom.current().nextInt(10000));
    }

    private String cleanName(String name) {
        String trimmed = name == null ? "" : name.trim();
        if (trimmed.length() > 12) {
            trimmed = trimmed.substring(0, 12);
        }
        return trimmed.replaceAll("[\\p{Cntrl}]", "");
    }

    private String text(JsonNode node, String field) {
        JsonNode value = node.get(field);
        return value == null || value.isNull() ? "" : value.asText("");
    }

    private void send(WebSocketSession session, Map<String, Object> payload) {
        if (session == null || !session.isOpen()) {
            return;
        }
        try {
            synchronized (session) {
                session.sendMessage(new TextMessage(mapper.writeValueAsString(payload)));
            }
        } catch (IOException ignored) {
            // 끊긴 연결은 다음 종료 이벤트에서 방을 정리한다.
        }
    }

    private static final class Room {
        private final String code;
        private final String difficulty;
        private final Player host;
        private final Instant createdAt;
        private Player guest;
        private boolean started;
        private boolean hostRematch;
        private boolean guestRematch;

        private Room(String code, String difficulty, Player host) {
            this.code = code;
            this.difficulty = difficulty;
            this.host = host;
            this.createdAt = Instant.now();
        }
    }

    private static final class Player {
        private final WebSocketSession session;
        private final String name;

        private Player(WebSocketSession session, String name) {
            this.session = session;
            this.name = name;
        }
    }
}
