export const onReady = fn =>
  (document.readyState === 'loading')
    ? document.addEventListener('DOMContentLoaded', fn)
    : fn();
