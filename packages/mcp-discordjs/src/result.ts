/**
 * Result type for fallible operations.
 * Inspired by Rust's Result<T, E> for explicit error handling.
 */

export type Result<T, E = Error> =
  | Success<T, E>
  | Failure<T, E>;

export class Success<T, E = Error> {
  readonly ok = true;
  readonly err = false;

  constructor(public readonly value: T) {}

  isSuccess(): this is Success<T, E> {
    return true;
  }

  isFailure(): this is Failure<T, E> {
    return false;
  }

  map<U>(fn: (value: T) => U): Result<U, E> {
    return new Success(fn(this.value));
  }

  flatMap<U>(fn: (value: T) => Result<U, E>): Result<U, E> {
    return fn(this.value);
  }

  unwrap(): T {
    return this.value;
  }

  unwrapOr(_default: T): T {
    return this.value;
  }

  unwrapErr(): never {
    throw new Error("Cannot unwrapErr on Success");
  }
}

export class Failure<T, E = Error> {
  readonly ok = false;
  readonly err = true;

  constructor(public readonly error: E) {}

  isSuccess(): this is Success<T, E> {
    return false;
  }

  isFailure(): this is Failure<T, E> {
    return true;
  }

  map<U>(_fn: (value: T) => U): Result<U, E> {
    return new Failure(this.error);
  }

  flatMap<U>(_fn: (value: T) => Result<U, E>): Result<U, E> {
    return new Failure(this.error);
  }

  unwrap(): never {
    throw this.error;
  }

  unwrapOr(defaultValue: T): T {
    return defaultValue;
  }

  unwrapErr(): E {
    return this.error;
  }
}

export function ok<T>(value: T): Success<T> {
  return new Success(value);
}

export function err<T = never, E = Error>(error: E): Result<T, E> {
  return new Failure(error);
}

/**
 * Type guard to narrow Result to Success.
 */
export function isSuccess<T, E>(result: Result<T, E>): result is Success<T, E> {
  return result.isSuccess();
}

/**
 * Type guard to narrow Result to Failure.
 */
export function isFailure<T, E>(result: Result<T, E>): result is Failure<T, E> {
  return result.isFailure();
}