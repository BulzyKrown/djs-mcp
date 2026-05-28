/**
 * Unit tests for CircuitBreaker.
 * Tests state transitions, failure threshold, and recovery.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { CircuitBreaker, CircuitState } from "../../src/circuit-breaker.js";

describe("CircuitBreaker", () => {
  let circuitBreaker: CircuitBreaker;

  beforeEach(() => {
    circuitBreaker = new CircuitBreaker({
      failureThreshold: 3,
      resetTimeout: 1000, // 1 second for faster tests
    });
  });

  describe("initial state", () => {
    it("starts in closed state", () => {
      expect(circuitBreaker.getState()).toBe(CircuitState.Closed);
    });

    it("allows requests initially", () => {
      expect(circuitBreaker.canRequest()).toBe(true);
    });

    it("has zero failures initially", () => {
      const stats = circuitBreaker.getStats();
      expect(stats.failures).toBe(0);
      expect(stats.lastFailure).toBeNull();
    });
  });

  describe("state transitions", () => {
    describe("closed to open", () => {
      it("opens after reaching failure threshold", () => {
        // Record failures up to threshold
        circuitBreaker.recordFailure();
        expect(circuitBreaker.getState()).toBe(CircuitState.Closed);
        
        circuitBreaker.recordFailure();
        expect(circuitBreaker.getState()).toBe(CircuitState.Closed);
        
        circuitBreaker.recordFailure(); // 3rd failure = threshold reached
        expect(circuitBreaker.getState()).toBe(CircuitState.Open);
      });

      it("does not open below failure threshold", () => {
        circuitBreaker.recordFailure();
        circuitBreaker.recordFailure();
        
        expect(circuitBreaker.getState()).toBe(CircuitState.Closed);
        expect(circuitBreaker.canRequest()).toBe(true);
      });

      it("records last failure time when opening", () => {
        circuitBreaker.recordFailure();
        circuitBreaker.recordFailure();
        circuitBreaker.recordFailure();
        
        const stats = circuitBreaker.getStats();
        expect(stats.lastFailure).not.toBeNull();
      });
    });

    describe("open to half-open", () => {
      it("transitions to half-open after reset timeout", async () => {
        // Open the circuit
        circuitBreaker.recordFailure();
        circuitBreaker.recordFailure();
        circuitBreaker.recordFailure();
        expect(circuitBreaker.getState()).toBe(CircuitState.Open);
        
        // Wait for reset timeout
        await new Promise((resolve) => setTimeout(resolve, 1100));
        
        // Check state transition
        expect(circuitBreaker.canRequest()).toBe(true);
        expect(circuitBreaker.getState()).toBe(CircuitState.HalfOpen);
      });

      it("stays open before reset timeout", () => {
        circuitBreaker.recordFailure();
        circuitBreaker.recordFailure();
        circuitBreaker.recordFailure();
        expect(circuitBreaker.getState()).toBe(CircuitState.Open);
        
        // Check before timeout
        expect(circuitBreaker.canRequest()).toBe(false);
      });
    });

    describe("half-open to closed (recovery)", () => {
      it("closes circuit on success in half-open state", async () => {
        // Open the circuit
        circuitBreaker.recordFailure();
        circuitBreaker.recordFailure();
        circuitBreaker.recordFailure();
        
        // Wait for reset timeout
        await new Promise((resolve) => setTimeout(resolve, 1100));
        
        // Should now be half-open
        expect(circuitBreaker.getState()).toBe(CircuitState.HalfOpen);
        
        // Record success
        circuitBreaker.recordSuccess();
        
        // Should be closed
        expect(circuitBreaker.getState()).toBe(CircuitState.Closed);
      });

      it("resets failure count after successful recovery", async () => {
        // Open the circuit
        circuitBreaker.recordFailure();
        circuitBreaker.recordFailure();
        circuitBreaker.recordFailure();
        
        // Wait for reset timeout
        await new Promise((resolve) => setTimeout(resolve, 1100));
        
        // Should transition to half-open after timeout
        expect(circuitBreaker.getState()).toBe(CircuitState.HalfOpen);
        
        // Recover - success in half-open closes circuit
        circuitBreaker.recordSuccess();
        
        // Should be closed after success
        expect(circuitBreaker.getState()).toBe(CircuitState.Closed);
      });

      it("failure in half-open state transitions to open", async () => {
        // Open the circuit
        circuitBreaker.recordFailure();
        circuitBreaker.recordFailure();
        circuitBreaker.recordFailure();
        
        // Wait for reset timeout
        await new Promise((resolve) => setTimeout(resolve, 1100));
        
        // Should be half-open
        expect(circuitBreaker.getState()).toBe(CircuitState.HalfOpen);
        
        // Failure in half-open state transitions to Open (recovery failed)
        circuitBreaker.recordFailure();
        
        expect(circuitBreaker.getState()).toBe(CircuitState.Open);
      });
    });
  });

  describe("failure threshold", () => {
    it("respects custom failure threshold", () => {
      const cb = new CircuitBreaker({
        failureThreshold: 1,
        resetTimeout: 1000,
      });
      
      cb.recordFailure();
      expect(cb.getState()).toBe(CircuitState.Open);
    });

    it("uses default threshold of 5 when not specified", () => {
      const cb = new CircuitBreaker({ resetTimeout: 1000 });
      
      for (let i = 0; i < 4; i++) {
        cb.recordFailure();
      }
      expect(cb.getState()).toBe(CircuitState.Closed);
      
      cb.recordFailure(); // 5th failure
      expect(cb.getState()).toBe(CircuitState.Open);
    });
  });

  describe("fast-fail behavior", () => {
    it("throws error when circuit is open and canRequest is called", () => {
      // Open the circuit
      circuitBreaker.recordFailure();
      circuitBreaker.recordFailure();
      circuitBreaker.recordFailure();
      
      expect(circuitBreaker.canRequest()).toBe(false);
    });

    it("execute throws error when circuit is open", async () => {
      // Open the circuit
      circuitBreaker.recordFailure();
      circuitBreaker.recordFailure();
      circuitBreaker.recordFailure();
      
      await expect(
        circuitBreaker.execute(async () => "result")
      ).rejects.toThrow("Circuit breaker is open");
    });

    it("execute records failure when operation throws", async () => {
      await expect(
        circuitBreaker.execute(async () => {
          throw new Error("operation failed");
        })
      ).rejects.toThrow("operation failed");
      
      const stats = circuitBreaker.getStats();
      expect(stats.failures).toBe(1);
    });

    it("execute records success when operation succeeds", async () => {
      const result = await circuitBreaker.execute(async () => "success");
      
      expect(result).toBe("success");
      const stats = circuitBreaker.getStats();
      expect(stats.failures).toBe(0);
    });
  });

  describe("reset behavior", () => {
    it("can manually reset circuit", () => {
      circuitBreaker.recordFailure();
      circuitBreaker.recordFailure();
      circuitBreaker.recordFailure();
      expect(circuitBreaker.getState()).toBe(CircuitState.Open);
      
      circuitBreaker.reset();
      
      expect(circuitBreaker.getState()).toBe(CircuitState.Closed);
      expect(circuitBreaker.canRequest()).toBe(true);
      expect(circuitBreaker.getStats().failures).toBe(0);
    });

    it("reset clears last failure time", () => {
      circuitBreaker.recordFailure();
      circuitBreaker.recordFailure();
      circuitBreaker.recordFailure();
      expect(circuitBreaker.getStats().lastFailure).not.toBeNull();
      
      circuitBreaker.reset();
      
      expect(circuitBreaker.getStats().lastFailure).toBeNull();
    });
  });

  describe("success in closed state", () => {
    it("resets failure count on success", () => {
      circuitBreaker.recordFailure();
      circuitBreaker.recordFailure();
      expect(circuitBreaker.getStats().failures).toBe(2);
      
      circuitBreaker.recordSuccess();
      
      expect(circuitBreaker.getStats().failures).toBe(0);
    });

    it("does not affect state in closed state", () => {
      expect(circuitBreaker.getState()).toBe(CircuitState.Closed);
      
      circuitBreaker.recordSuccess();
      
      expect(circuitBreaker.getState()).toBe(CircuitState.Closed);
    });
  });

  describe("getStats", () => {
    it("returns current state, failures, and last failure time", () => {
      circuitBreaker.recordFailure();
      circuitBreaker.recordFailure();
      
      const stats = circuitBreaker.getStats();
      
      expect(stats).toEqual({
        state: CircuitState.Closed,
        failures: 2,
        lastFailure: expect.any(Number),
      });
    });
  });
});