/**
 * Utility functions for exact currency arithmetic to prevent floating-point inaccuracies.
 */

const MAX_SUPPORTED_AMOUNT = 1_000_000_000; // 1 Billion

/**
 * Validates whether an amount is within supported limits and has at most 2 decimal places.
 * @param allowZero Whether zero is acceptable (e.g. for account balances). Defaults to false.
 */
export function validateAmount(
  amount: any,
  allowZero: boolean = false
): { valid: boolean; error?: string; formatted?: string } {
  if (amount === undefined || amount === null) {
    return { valid: false, error: 'Amount is required' };
  }

  let str: string;
  if (typeof amount === 'number') {
    if (!Number.isFinite(amount)) {
      return { valid: false, error: 'Amount must be a finite number' };
    }
    str = amount.toString();
  } else if (typeof amount === 'string') {
    str = amount.trim();
  } else {
    return { valid: false, error: 'Amount must be a number or numeric string' };
  }

  // Regex checks non-negative number with up to 2 decimal places: e.g. 0, 100, 100.5, 100.50
  const currencyRegex = /^\d+(\.\d{1,2})?$/;
  if (!currencyRegex.test(str)) {
    return {
      valid: false,
      error: 'Invalid amount. Must be a positive amount with at most 2 decimal places.',
    };
  }

  const num = parseFloat(str);
  if (allowZero ? num < 0 : num <= 0) {
    return {
      valid: false,
      error: allowZero
        ? 'Amount cannot be negative'
        : 'Amount must be greater than zero',
    };
  }

  if (num > MAX_SUPPORTED_AMOUNT) {
    return { valid: false, error: `Amount cannot exceed ${MAX_SUPPORTED_AMOUNT.toLocaleString()}` };
  }

  // Convert to exact 2-decimal string format
  const [whole, decimal = ''] = str.split('.');
  const formatted = `${whole}.${(decimal + '00').slice(0, 2)}`;

  return { valid: true, formatted };
}

/**
 * Converts a validated amount string or number to integer cents (bigint) for exact arithmetic.
 * By default allows zero (for balances).
 */
export function toCents(amount: string | number, allowZero: boolean = true): bigint {
  const validation = validateAmount(amount, allowZero);
  if (!validation.valid || !validation.formatted) {
    throw new Error(validation.error || 'Invalid monetary amount');
  }

  const [whole, decimal] = validation.formatted.split('.');
  return BigInt(whole) * 100n + BigInt(decimal);
}

/**
 * Converts integer cents (bigint) back to an exact two-decimal string.
 */
export function fromCents(cents: bigint): string {
  const isNegative = cents < 0n;
  const absCents = isNegative ? -cents : cents;
  const whole = absCents / 100n;
  const remainder = absCents % 100n;
  const remainderStr = remainder.toString().padStart(2, '0');
  return `${isNegative ? '-' : ''}${whole}.${remainderStr}`;
}
