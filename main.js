class LottoBall extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
    }

    connectedCallback() {
        const number = this.getAttribute('number');
        const color = this.getAttribute('color');
        this.shadowRoot.innerHTML = `
            <style>
                .ball {
                    width: var(--ball-size, 50px);
                    height: var(--ball-size, 50px);
                    border-radius: 50%;
                    background-color: ${color};
                    color: white;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    font-size: 1.5rem;
                    font-weight: bold;
                    box-shadow: 0 4px 15px rgba(0, 0, 0, 0.4), inset 0 -4px 10px ${color}99;
                    animation: appear 0.5s ease-out forwards;
                    transform: scale(0);
                }

                @keyframes appear {
                    to {
                        transform: scale(1);
                    }
                }
            </style>
            <div class="ball">${number}</div>
        `;
    }
}

customElements.define('lotto-ball', LottoBall);

const generateBtn = document.getElementById('generate-btn');
const numbersContainer = document.getElementById('lotto-numbers');

generateBtn.addEventListener('click', () => {
    numbersContainer.innerHTML = '';
    const numbers = new Set();
    while (numbers.size < 6) {
        numbers.add(Math.floor(Math.random() * 45) + 1);
    }

    const sortedNumbers = [...numbers].sort((a, b) => a - b);

    sortedNumbers.forEach((number, index) => {
        const lottoBall = document.createElement('lotto-ball');
        lottoBall.setAttribute('number', number);
        lottoBall.setAttribute('color', getBallColor(number));
        lottoBall.style.animationDelay = `${index * 0.1}s`;
        numbersContainer.appendChild(lottoBall);
    });
});

function getBallColor(number) {
    if (number <= 10) return '#fbc400'; // Yellow
    if (number <= 20) return '#69c8f2'; // Blue
    if (number <= 30) return '#ff7272'; // Red
    if (number <= 40) return '#aaa'; // Gray
    return '#b0d840'; // Green
}
