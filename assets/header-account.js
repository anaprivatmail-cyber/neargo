// Header Account Menu - User Icon Dropdown
(function() {
  'use strict';
  
  const accountWrap = document.getElementById('accountWrap');
  const accountMenu = document.getElementById('accountMenu');
  let menuOpen = false;

  if (!accountWrap || !accountMenu) return;

  // Toggle menu visibility
  function setMenuOpen(state) {
    menuOpen = (typeof state !== 'undefined') ? state : !menuOpen;
    if (accountMenu) {
      accountMenu.style.display = menuOpen ? 'block' : 'none';
    }
  }

  // Click on account wrapper to toggle menu
  accountWrap.addEventListener('click', function(e) {
    // Don't toggle if clicking inside the menu itself
    if (!(e.target && e.target.closest && e.target.closest('.account-menu'))) {
      setMenuOpen();
    }
  });

  // Close menu when clicking outside
  document.addEventListener('click', function(e) {
    if (accountWrap && !accountWrap.contains(e.target)) {
      setMenuOpen(false);
    }
  });

  // Handle menu item clicks
  accountMenu.addEventListener('click', function(e) {
    const link = e.target && e.target.closest ? e.target.closest('a[data-action]') : null;
    if (!link) return;
    
    // Prevent default anchor behavior (scrolling to top)
    e.preventDefault();
    
    const action = link.getAttribute('data-action');
    
    // Close menu after clicking any item
    setMenuOpen(false);
    
    // Handle different actions
    if (action === 'my') {
      window.location.href = '/my.html';
    } else if (action === 'logout') {
      // TODO: Implement actual logout functionality
      if (window._toast) {
        window._toast('Funkcija odjave bo na voljo kmalu', false);
      }
      // In production, would call logout API
    }
  });
})();
