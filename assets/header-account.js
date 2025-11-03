// Header Account Dropdown Menu Functionality
(function() {
  'use strict';

  // DOM elements
  const btnMine = document.getElementById('btnMine');
  const accountMenu = document.getElementById('accountMenu');
  const pointsBadge = document.getElementById('pointsBadge');
  const accountMenuPointsBadge = document.getElementById('accountMenuPointsBadge');
  const accountMenuLogout = document.getElementById('accountMenuLogout');
  const accountMenuSettings = document.getElementById('accountMenuSettings');
  const accountMenuPoints = document.getElementById('accountMenuPoints');

  if (!btnMine || !accountMenu) {
    return; // Exit if required elements don't exist
  }

  // Toggle dropdown menu
  function toggleAccountMenu(event) {
    event.preventDefault();
    event.stopPropagation();
    
    const isVisible = accountMenu.style.display === 'block';
    
    // Close all other menus
    document.querySelectorAll('.lang-menu').forEach(menu => {
      menu.style.display = 'none';
    });
    
    // Toggle this menu
    accountMenu.style.display = isVisible ? 'none' : 'block';
    
    // Update points badge in menu
    if (pointsBadge && accountMenuPointsBadge) {
      const points = pointsBadge.textContent || '0';
      accountMenuPointsBadge.textContent = points;
    }
  }

  // Close menu when clicking outside
  function closeMenuOnClickOutside(event) {
    if (accountMenu.style.display === 'block' && 
        !btnMine.contains(event.target) && 
        !accountMenu.contains(event.target)) {
      accountMenu.style.display = 'none';
    }
  }

  // Handle logout
  function handleLogout(event) {
    event.preventDefault();
    
    // Clear user data from localStorage
    localStorage.removeItem('user_email');
    localStorage.removeItem('user_name');
    localStorage.removeItem('supabase.auth.token');
    
    // Show confirmation toast if available
    if (window._toast) {
      window._toast('Uspešno odjavljeni', true);
    }
    
    // Close menu
    accountMenu.style.display = 'none';
    
    // Redirect to home after a short delay
    setTimeout(() => {
      window.location.href = '/';
    }, 500);
  }

  // Handle settings click
  function handleSettings(event) {
    event.preventDefault();
    accountMenu.style.display = 'none';
    window.location.href = '/my.html#profileSettings';
  }

  // Handle points click
  function handlePointsClick(event) {
    event.preventDefault();
    accountMenu.style.display = 'none';
    window.location.href = '/my.html#pointsSection';
  }

  // Event listeners
  btnMine.addEventListener('click', toggleAccountMenu);
  document.addEventListener('click', closeMenuOnClickOutside);
  
  if (accountMenuLogout) {
    accountMenuLogout.addEventListener('click', handleLogout);
  }
  
  if (accountMenuSettings) {
    accountMenuSettings.addEventListener('click', handleSettings);
  }

  if (accountMenuPoints) {
    accountMenuPoints.addEventListener('click', handlePointsClick);
  }

  // Close menu when pressing Escape key
  document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape' && accountMenu.style.display === 'block') {
      accountMenu.style.display = 'none';
    }
  });

  // Update points badge in menu when points badge changes
  if (pointsBadge) {
    const observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
        if (mutation.type === 'characterData' || mutation.type === 'childList') {
          if (accountMenuPointsBadge) {
            accountMenuPointsBadge.textContent = pointsBadge.textContent || '0';
          }
        }
      });
    });

    observer.observe(pointsBadge, {
      characterData: true,
      childList: true,
      subtree: true
    });
  }

})();
