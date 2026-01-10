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
            body.dataset.theme = 'dark';
            themeToggleBtn.textContent = '🌙';
        }
    }

    themeToggleBtn.addEventListener('click', () => {
        let newTheme = body.dataset.theme === 'light' ? 'dark' : 'light';
        localStorage.setItem('theme', newTheme);
        applyTheme(newTheme);
    });

    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
        applyTheme(savedTheme);
    } else {
        applyTheme('dark');
    }
})();

// --- Smooth Scrolling ---
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

// --- AI Food Image Generator ---
(function() {
    const foodGenerateBtn = document.getElementById('food-generate-btn');
    if (!foodGenerateBtn) return;
    
    const foodInput = document.getElementById('food-input');
    const imageContainer = document.getElementById('food-image-container');
    const toolCard = document.getElementById('food-generator');
    const promptDisplay = toolCard.querySelector('.prompt-display');

    foodGenerateBtn.addEventListener('click', () => {
        const foodName = foodInput.value;
        if (!foodName) {
            alert('음식 이름을 입력해주세요!');
            return;
        }

        const spinner = imageContainer.querySelector('.loading-spinner');
        const image = imageContainer.querySelector('img');

        spinner.style.display = 'block';
        image.style.display = 'none';
        promptDisplay.style.display = 'none';

        setTimeout(() => {
            const randomImageUrl = `https://picsum.photos/400/300?random=${Math.random()}`;
            image.src = randomImageUrl;
            image.alt = `${foodName} 이미지`;
            
            image.onload = () => {
                spinner.style.display = 'none';
                image.style.display = 'block';
                promptDisplay.innerHTML = `<span>Prompt:</span> "${foodName}"`;
                promptDisplay.style.display = 'block';
            };
        }, 1500);
    });
})();


// --- Teachable Machine ---
let tm_model, tm_webcam, tm_labelContainer, tm_maxPredictions;
const TM_URL = "./my_model/";

async function tm_init() {
    const modelURL = TM_URL + "model.json";
    const metadataURL = TM_URL + "metadata.json";
    const webcamContainer = document.getElementById("webcam-container");
    tm_labelContainer = document.getElementById("label-container");

    try {
        tm_model = await tmImage.load(modelURL, metadataURL);
        tm_maxPredictions = tm_model.getTotalClasses();

        const flip = true;
        tm_webcam = new tmImage.Webcam(200, 200, flip);
        await tm_webcam.setup();
        await tm_webcam.play();
        window.requestAnimationFrame(tm_loop);

        webcamContainer.innerHTML = '';
        webcamContainer.appendChild(tm_webcam.canvas);
        tm_labelContainer.innerHTML = '';
        for (let i = 0; i < tm_maxPredictions; i++) {
            tm_labelContainer.appendChild(document.createElement("div"));
        }
    } catch (error) {
        console.error("Error loading Teachable Machine model:", error);
        tm_labelContainer.innerHTML = "모델 로드 실패: 'my_model' 폴더에 파일이 올바르게 있는지 확인하세요.";
    }
}

async function tm_loop() {
    if (tm_webcam && tm_webcam.canvas) {
        tm_webcam.update();
        await tm_predict();
        window.requestAnimationFrame(tm_loop);
    }
}

async function tm_predict() {
    if (tm_model && tm_webcam.canvas) {
        const prediction = await tm_model.predict(tm_webcam.canvas);
        for (let i = 0; i < tm_maxPredictions; i++) {
            const classPrediction =
                prediction[i].className + ": " + prediction[i].probability.toFixed(2);
            if (tm_labelContainer.childNodes[i]) {
                tm_labelContainer.childNodes[i].innerHTML = classPrediction;
            }
        }
    }
}

const tmStartBtn = document.getElementById('tm-start-btn');
if (tmStartBtn) {
    tmStartBtn.addEventListener('click', tm_init);
}
