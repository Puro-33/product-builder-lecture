// --- Theme Toggle ---
(function() {
    const themeToggleBtn = document.getElementById('theme-toggle-btn');
    if (!themeToggleBtn) return;
    const body = document.body;

    function applyTheme(theme) {
        if (theme === 'light') {
            body.dataset.theme = 'light';
            themeToggleBtn.textContent = '☀️';
        } else {
            delete body.dataset.theme;
            themeToggleBtn.textContent = '🌙';
        }
    }

    themeToggleBtn.addEventListener('click', () => {
        let newTheme = body.dataset.theme === 'light' ? 'dark' : 'light';
        localStorage.setItem('theme', newTheme);
        applyTheme(newTheme);
    });

    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

    if (savedTheme) {
        applyTheme(savedTheme);
    } else if (prefersDark) {
        applyTheme('dark');
    } else {
        applyTheme('light'); // Default to light for better initial readability
    }
})();

// --- AI Food Image Generator ---
(function() {
    const foodGenerateBtn = document.getElementById('food-generate-btn');
    if (!foodGenerateBtn) return;
    
    const foodInput = document.getElementById('food-input');
    const foodLoadingSpinner = document.getElementById('food-loading-spinner');
    const foodImageDisplay = document.getElementById('food-image-display');
    const foodGeneratedImageUrl = 'https://images.pexels.com/photos/3026806/pexels-photo-3026806.jpeg';

    foodGenerateBtn.addEventListener('click', () => {
        const foodName = foodInput.value;
        if (!foodName) {
            alert('음식 이름을 입력해주세요!');
            return;
        }

        foodLoadingSpinner.style.display = 'block';
        foodImageDisplay.style.display = 'none';

        setTimeout(() => {
            foodImageDisplay.src = foodGeneratedImageUrl;
            foodImageDisplay.alt = `${foodName} 이미지`;
            foodLoadingSpinner.style.display = 'none';
            foodImageDisplay.style.display = 'block';
        }, 1500);
    });
})();

// --- Smooth Scrolling Navigation ---
(function() {
    document.querySelectorAll('.main-nav a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const targetId = this.getAttribute('href');
            const targetElement = document.querySelector(targetId);
            if (targetElement) {
                targetElement.scrollIntoView({
                    behavior: 'smooth'
                });
            }
        });
    });
})();