package com.tetris.game;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class TetrisApplication {

    public static void main(String[] args) {
        System.setProperty("spring.backgroundpreinitializer.ignore", "true");
        SpringApplication.run(TetrisApplication.class, args);
    }
}
