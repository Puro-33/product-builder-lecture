// --- AI Food Image Generator ---
const generateBtn = document.getElementById('generate-btn');
const foodInput = document.getElementById('food-input');
const imageContainer = document.getElementById('image-container');
const loadingSpinner = document.getElementById('loading-spinner');
const foodImage = document.getElementById('food-image');

// Placeholder image URL for simulation
const generatedImageUrl = 'https://images.pexels.com/photos/3026806/pexels-photo-3026806.jpeg';

generateBtn.addEventListener('click', () => {
    // 1. Get user input (though we don't use it for the simulation)
    const foodName = foodInput.value;
    if (!foodName) {
        alert('Please enter a food name!');
        return;
    }

    // 2. Show loading spinner and hide image
    loadingSpinner.style.display = 'block';
    foodImage.style.display = 'none';

    // 3. Simulate AI generation delay
    setTimeout(() => {
        // 4. Show the "generated" image
        foodImage.src = generatedImageUrl;
        foodImage.alt = `An image of ${foodName}`;
        
        // 5. Hide spinner and display image
        loadingSpinner.style.display = 'none';
        foodImage.style.display = 'block';

    }, 1500); // 1.5 second delay
});


// --- Theme Toggle ---
const themeToggleBtn = document.getElementById('theme-toggle-btn');
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

// Apply saved theme or system preference on load
const savedTheme = localStorage.getItem('theme');
const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;

if (savedTheme) {
    applyTheme(savedTheme);
} else if (prefersDark) {
    applyTheme('dark');
} else {
    // Default to dark theme if nothing is set
    applyTheme('dark');
}
