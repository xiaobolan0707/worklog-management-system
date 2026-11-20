/**
 * 统一口令策略（SEC-04）。
 *
 * 注册、管理员建号、重置密码、首次改密、自助改密共用同一套规则，
 * 避免各入口强度不一致。策略只对新设置的密码生效，不影响既有口令的登录校验。
 */

export const PASSWORD_MIN_LENGTH = 6;
export const PASSWORD_MAX_LENGTH = 256;

export const PASSWORD_POLICY_HINT = `密码至少 ${PASSWORD_MIN_LENGTH} 位`;

const COMMON_PASSWORDS = new Set([
  "1234567890", "0123456789", "123456789a", "123456789abc",
  "password", "password1", "password123", "p@ssw0rd", "p@ssword123",
  "qwertyuiop", "qwerty123", "qwerty12345", "asdfghjkl",
  "1111111111", "0000000000", "1231231231", "abc1234567",
  "aaaaaaaaaa", "aaaaaaaaaa1", "iloveyou123", "admin12345",
  "admin123456", "root123456", "test123456", "worklog123",
  "welcome123", "letmein12345", "dragon1234", "monkey1234",
  "football12", "baseball12", "sunshine12", "master1234",
  "superman12", "batman1234", "trustno1234", "shadow1234"
]);

const SEQUENCES = [
  "abcdefghijklmnopqrstuvwxyz",
  "zyxwvutsrqponmlkjihgfedcba",
  "01234567890",
  "09876543210",
  "qwertyuiop",
  "poiuytrewq",
  "asdfghjkl",
  "lkjhgfdsa",
  "zxcvbnm"
];

export interface PasswordStrengthInput {
  password: string;
  username?: string | null | undefined;
  displayName?: string | null | undefined;
}

function hasLongSequence(password: string): boolean {
  for (const sequence of SEQUENCES) {
    for (let index = 0; index + 4 <= sequence.length; index += 1) {
      if (password.includes(sequence.slice(index, index + 4))) return true;
    }
  }
  return false;
}

/** 返回 null 表示通过；否则返回面向用户的中文提示。 */
export function passwordStrengthError(input: PasswordStrengthInput): string | null {
  const password = input.password ?? "";
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `密码至少 ${PASSWORD_MIN_LENGTH} 位`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `密码最长 ${PASSWORD_MAX_LENGTH} 位`;
  }
  if (/\s/.test(password)) {
    return "密码不能包含空白字符";
  }
  return null;
}

export function isPasswordAcceptable(input: PasswordStrengthInput): boolean {
  return passwordStrengthError(input) === null;
}
