/**
 * Date/time utilities for the Polymarket trading app
 * Uses native Date APIs only - no external dependencies
 */

// =============================================================================
// Helper to normalize date input
// =============================================================================

function toDate(date: Date | string | number): Date {
  if (date instanceof Date) return date;
  if (typeof date === 'string') return new Date(date);
  return new Date(date);
}

// =============================================================================
// Time component calculations
// =============================================================================

/**
 * Get time components until a future date
 *
 * @param date - Target date
 * @returns Object with days, hours, minutes, seconds until date
 *
 * @example
 * getTimeUntil('2025-12-31') // { days: 30, hours: 5, minutes: 20, seconds: 45 }
 */
export function getTimeUntil(date: Date | string | number): {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
} {
  const target = toDate(date);
  const now = new Date();
  const diff = Math.max(0, target.getTime() - now.getTime());

  const seconds = Math.floor((diff / 1000) % 60);
  const minutes = Math.floor((diff / (1000 * 60)) % 60);
  const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  return { days, hours, minutes, seconds };
}

// =============================================================================
// Expiration check
// =============================================================================

/**
 * Check if a date is in the past
 *
 * @param date - Date to check
 * @returns True if date is in the past
 *
 * @example
 * isExpired('2020-01-01') // true
 * isExpired('2030-01-01') // false
 */
export function isExpired(date: Date | string | number): boolean {
  const target = toDate(date);
  return target.getTime() < Date.now();
}

// =============================================================================
// Relative time formatting
// =============================================================================

/**
 * Format a date as relative time (e.g., "2h ago", "in 3d")
 *
 * @param date - Date to format
 * @returns Relative time string
 *
 * @example
 * formatRelativeTime(Date.now() - 3600000) // "1h ago"
 * formatRelativeTime(Date.now() + 86400000) // "in 1d"
 */
export function formatRelativeTime(date: Date | string | number): string {
  const target = toDate(date);
  const now = Date.now();
  const diff = target.getTime() - now;
  const absDiff = Math.abs(diff);
  const isPast = diff < 0;

  // Less than a minute
  if (absDiff < 60 * 1000) {
    return 'just now';
  }

  // Less than an hour
  if (absDiff < 60 * 60 * 1000) {
    const minutes = Math.floor(absDiff / (60 * 1000));
    return isPast ? `${minutes}m ago` : `in ${minutes}m`;
  }

  // Less than a day
  if (absDiff < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(absDiff / (60 * 60 * 1000));
    return isPast ? `${hours}h ago` : `in ${hours}h`;
  }

  // Less than a week
  if (absDiff < 7 * 24 * 60 * 60 * 1000) {
    const days = Math.floor(absDiff / (24 * 60 * 60 * 1000));
    return isPast ? `${days}d ago` : `in ${days}d`;
  }

  // Less than a month (30 days)
  if (absDiff < 30 * 24 * 60 * 60 * 1000) {
    const weeks = Math.floor(absDiff / (7 * 24 * 60 * 60 * 1000));
    return isPast ? `${weeks}w ago` : `in ${weeks}w`;
  }

  // Less than a year
  if (absDiff < 365 * 24 * 60 * 60 * 1000) {
    const months = Math.floor(absDiff / (30 * 24 * 60 * 60 * 1000));
    return isPast ? `${months}mo ago` : `in ${months}mo`;
  }

  // More than a year
  const years = Math.floor(absDiff / (365 * 24 * 60 * 60 * 1000));
  return isPast ? `${years}y ago` : `in ${years}y`;
}

// =============================================================================
// Countdown formatting
// =============================================================================

/**
 * Format a countdown to a future date
 *
 * @param endDate - End date for countdown
 * @returns Countdown string like "2d 5h 30m" or "Ended"
 *
 * @example
 * formatCountdown(futureDate) // "2d 5h 30m"
 * formatCountdown(pastDate) // "Ended"
 */
export function formatCountdown(endDate: Date | string | number): string {
  const target = toDate(endDate);
  const now = Date.now();
  const diff = target.getTime() - now;

  if (diff <= 0) {
    return 'Ended';
  }

  const { days, hours, minutes } = getTimeUntil(target);

  // Show days if > 0
  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }

  // Show hours and minutes if > 0
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  // Show minutes only
  if (minutes > 0) {
    return `${minutes}m`;
  }

  // Less than a minute
  return '< 1m';
}

// =============================================================================
// Date formatting
// =============================================================================

/**
 * Format a date in short or long format
 *
 * @param date - Date to format
 * @param format - Format style ('short' or 'long')
 * @returns Formatted date string
 *
 * @example
 * formatDate(date) // "Jan 15, 2026"
 * formatDate(date, 'long') // "January 15, 2026 at 3:30 PM"
 */
export function formatDate(
  date: Date | string | number,
  format: 'short' | 'long' = 'short'
): string {
  const target = toDate(date);

  if (format === 'long') {
    return target.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }

  return target.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

