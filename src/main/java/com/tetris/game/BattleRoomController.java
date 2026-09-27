package com.tetris.game;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/rooms")
public class BattleRoomController {

    private final BattleHandler battleHandler;

    public BattleRoomController(BattleHandler battleHandler) {
        this.battleHandler = battleHandler;
    }

    @GetMapping("/waiting")
    public List<Map<String, String>> waiting() {
        return battleHandler.listWaiting();
    }
}
