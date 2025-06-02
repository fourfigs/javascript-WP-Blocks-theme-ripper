# HTML to WordPress FSE Theme Converter

## Description

This script converts a collection of static HTML files and associated CSS into a basic WordPress Full Site Editing (FSE) block theme. It aims to automate the initial, often tedious, steps of theming by transforming standard HTML elements into their corresponding WordPress block equivalents and extracting styles into the theme's `theme.json` and `style.css` files.

## Accomplishments & Features

*   **WordPress Theme Structure:** Generates a standard FSE theme directory (`converted-wp-theme`) containing:
    *   `style.css`: Basic theme information and custom styles.
    *   `index.php`: Main template file for block themes.
    *   `theme.json`: Populated with settings for colors, typography, layout, and custom styles.
    *   `templates/` directory: For HTML template files (e.g., `index.html`, `page.html`) converted to block syntax.
    *   `parts/` directory: For HTML template parts like headers or footers, if common ones are detected.
*   **HTML to Block Conversion:**
    *   Converts common HTML elements (e.g., `<h1>-<h6>`, `<p>`, `<img>`, `<ul>`, `<ol>`, `<li>`) into their respective WordPress blocks (`wp:heading`, `wp:paragraph`, `wp:image`, `wp:list`, `wp:list-item`).
    *   Semantic elements like `<header>`, `<footer>`, `<main>`, and generic `<div>`s are typically converted to `wp:group` blocks, with their original tag name preserved in the block's attributes (e.g., `<!-- wp:group {"tagName":"header"} -->`).
    *   Navigation menus (`<nav>`) are converted into `wp:navigation` blocks, with list items transformed into `wp:navigation-link` blocks.
*   **CSS Processing:**
    *   Parses CSS files to extract style information.
    *   Populates `theme.json` with:
        *   A color palette extracted from CSS color declarations.
        *   Font families found in `font-family` rules.
        *   Basic layout settings (content width, wide width) if derivable.
        *   Some global typography settings (e.g., base font size).
    *   Generates custom CSS classes (e.g., `.custom-style-1`) for CSS rules that cannot be directly mapped to block attributes or `theme.json` settings. These classes are added to `style.css` and applied to the relevant blocks.
    *   Handles CSS animations and transitions:
        *   `@keyframes` rules are extracted and added to `style.css`.
        *   Animation and transition properties applied to elements are captured and included in the custom CSS classes.
*   **Common Parts Detection:** Includes logic to identify and extract common HTML sections (like headers or footers) into reusable theme parts in the `parts/` directory. (Effectiveness depends on the consistency of these sections across HTML files).

## Prerequisites

*   **Node.js:** Ensure you have Node.js installed (which includes npm). You can download it from [nodejs.org](https://nodejs.org/).
*   **NPM Packages:** Project dependencies listed in `package.json`.

## Installation

1.  Clone or download the script files. Ensure the `html-to-wp-theme-converter` directory contains `index.js`, `package.json`, etc.
2.  Navigate to the `html-to-wp-theme-converter` directory in your terminal.
3.  Install the necessary npm packages:
    ```bash
    npm install
    ```

## Usage

Run the script from the `html-to-wp-theme-converter` directory using Node.js:

```bash
node index.js <input_html_dir> [input_css_dir]
```

**Arguments:**

*   `<input_html_dir>` (Mandatory): The path to the directory containing your static HTML files.
    *   Example: `../my_html_site/html_files` or `sample_project/html` (if `sample_project` is in the same parent directory as `html-to-wp-theme-converter`).
*   `[input_css_dir]` (Optional): The path to the directory containing your CSS files.
    *   If not provided, CSS processing will be skipped, and `theme.json` will only contain minimal default settings. Custom styles and animations dependent on CSS will not be extracted.
    *   Example: `../my_html_site/css_files` or `sample_project/css`.

**Example Command (assuming `sample_project` is in the parent directory):**

```bash
node index.js ../sample_project/html ../sample_project/css
```
Or, if `sample_project` is inside `html-to-wp-theme-converter`:
```bash
node index.js ./sample_project/html ./sample_project/css
```

## Output

The script generates a new directory named `converted-wp-theme` inside the `html-to-wp-theme-converter` directory. This `converted-wp-theme` folder contains the generated WordPress theme.

You can then take the `converted-wp-theme` folder and install it as a theme in your WordPress site (e.g., by zipping it and uploading through the WordPress admin, or by copying it to `wp-content/themes/`).

## Current Limitations & Manual Steps

*   **JavaScript Not Handled:** The script does **not** process or convert any JavaScript. Dynamic functionalities, client-side interactions, and JS-based animations must be manually rebuilt or integrated into the WordPress theme.
*   **Asset Management:** Image files, font files, and other assets referenced in your HTML/CSS are **not** automatically copied into the theme. You will need to manually move these assets to your WordPress uploads directory or the theme's asset folder and update paths in the generated templates or CSS if necessary.
*   **Complex Structures:** Highly complex or unconventional HTML structures and CSS layouts may not be perfectly converted and might require manual adjustments in the block editor or theme files.
*   **CSS Specificity & Overrides:** While the script attempts to map styles, complex CSS selector specificity and overrides might lead to visual discrepancies that need manual tweaking.
*   **Manual Verification:** Always test the generated theme thoroughly in a WordPress environment. This includes:
    *   Verifying page layouts and content rendering.
    *   Checking that styles are applied as expected.
    *   Ensuring CSS animations and transitions work correctly.

## Flags/Options

Currently, the script does not have explicit command-line flags. The primary way to control its behavior is by providing or omitting the `input_css_dir` argument:

*   **Providing `input_css_dir`:** Enables CSS processing, `theme.json` population from CSS, custom style generation, and animation handling.
*   **Omitting `input_css_dir`:** Skips all CSS-dependent features. The theme will be structurally converted but will have minimal styling.

## Troubleshooting

*   **Errors during execution:** Check the console output for error messages. Common issues might include incorrect paths to input directories or problems with file permissions.
*   **Styling issues:** If styles look incorrect, inspect `theme.json` and the custom classes in `style.css`. You may need to adjust CSS manually.

## Future Enhancements (Potential)

*   Automated asset copying (images, fonts).
*   More sophisticated CSS parsing (e.g., advanced selectors, CSS variables).
*   User-configurable options for theme metadata (name, author, version).
*   Option to map input HTML filenames to specific WordPress template hierarchy names.
```
