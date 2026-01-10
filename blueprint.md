# Lotto Number Generator

## Overview

A simple, visually appealing web application to generate random lottery numbers. The application will feature a modern design with interactive elements and animations, built using vanilla HTML, CSS, and JavaScript with Web Components.

## Design and Features

*   **UI/UX:**
    *   A clean, centered layout that is mobile-responsive.
    *   A prominent title and a clear call-to-action button.
    *   Generated numbers will be displayed as animated "lotto balls" with a distinct, colorful design.
    *   Subtle background texture and soft drop shadows to create a sense of depth and a premium feel.
    *   Interactive button with a "glow" effect on hover/focus.
*   **Functionality:**
    *   Clicking the "Generate Numbers" button will produce 6 unique random numbers between 1 and 45.
    *   The numbers will be sorted in ascending order.
    *   The generated numbers will be displayed with a smooth animation.
*   **Technology:**
    *   **HTML:** Semantic HTML5 structure.
    *   **CSS:** Modern CSS including Flexbox for layout, CSS Variables for theming, and animations.
    *   **JavaScript:** ES Modules and a custom Web Component (`lotto-ball`) for the number display.

## Current Plan

1.  **Structure (`index.html`):**
    *   Set up the main container for the application.
    *   Add a title, a container for the lotto balls, and a "Generate" button.

2.  **Styling (`style.css`):**
    *   Implement the modern design, including colors, fonts, spacing, and shadows.
    *   Style the lotto balls and the button.
    *   Add animations for the number display.

3.  **Logic (`main.js`):**
    *   Create the `LottoBall` custom element.
    *   Implement the lottery number generation logic.
    *   Add the event listener for the "Generate" button to trigger the process.
