// assets/provider-plan.js
// Shared plan feature map for organizer capabilities across UI
// Expose as both module export and global for legacy inline scripts

export const NG_PLAN_FEATURES = Object.freeze({
  free: {
    label: 'Brezplačno',
    featuredPerMonth: 0,
    calendar: false,
    qrScanner: false,
    analytics: 'basic',
    teamAccess: false,
  },
  grow: {
    label: 'Grow',
    featuredPerMonth: 1,
    calendar: false,
    qrScanner: true,
    analytics: 'realtime',
    teamAccess: false,
  },
  pro: {
    label: 'Pro',
    featuredPerMonth: 3,
    calendar: true,
    qrScanner: true,
    analytics: 'advanced',
    teamAccess: true,
  }
});

// Make available globally for non-module scripts
try { window.NG_PLAN_FEATURES = NG_PLAN_FEATURES; } catch {}
