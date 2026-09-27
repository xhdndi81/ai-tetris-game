package com.tetris.game;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

@Configuration
@EnableWebSocket
public class BattleSocketConfig implements WebSocketConfigurer {

    private final BattleHandler battleHandler;

    public BattleSocketConfig(BattleHandler battleHandler) {
        this.battleHandler = battleHandler;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(battleHandler, "/ws/battle").setAllowedOrigins("*");
    }
}
