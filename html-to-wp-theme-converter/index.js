const fs = require('fs-extra');
const path = require('path');
const cheerio = require('cheerio');
const postcss = require('postcss');

const inputDir = process.argv[2];
const cssDir = process.argv[3]; // CSS directory input
const baseOutputDir = path.resolve(process.cwd(), 'converted-wp-theme');

// Globals to store information about common parts
let commonHeaderOriginalHtml = null;
let commonHeaderBlockHtml = null;
let commonFooterOriginalHtml = null;
let commonFooterBlockHtml = null;
let headerTagName = "header"; // Default, can be updated if original was div
let footerTagName = "footer"; // Default

let globalCssAst = null; // To store the loaded CSS AST
let globalThemeJsonData = null; // To store loaded theme.json data
let customCssRulesForStyleSheet = []; // To collect custom CSS rules
let customClassCounter = 0; // Counter for unique class names

if (!inputDir) {
  console.error('Error: Please provide an input HTML directory path as the first command-line argument.');
  process.exit(1);
}
// Note: cssDir is optional for the script to run, but CSS processing will be skipped if not provided.

async function setupThemeDirectory() {
  try {
    console.log(`Attempting to create theme directory at: ${baseOutputDir}`);
    // Remove existing directory to ensure a clean slate
    await fs.remove(baseOutputDir);
    console.log(`Removed existing directory (if any): ${baseOutputDir}`);
    
    // Create the main theme directory
    await fs.ensureDir(baseOutputDir);
    console.log(`Created theme directory: ${baseOutputDir}`);

    // Create style.css
    const themeName = "Converted WP Theme";
    const textDomain = "converted-wp-theme";
    const styleCssContent = `/*
Theme Name: ${themeName}
Theme URI: https://example.com/${textDomain}
Author: Theme Converter Script
Author URI: https://example.com/
Description: A theme converted from HTML by a script.
Version: 1.0
License: GNU General Public License v2 or later
License URI: http://www.gnu.org/licenses/gpl-2.0.html
Text Domain: ${textDomain}
Tags: block-styles, full-site-editing, accessibility-ready
*/`;
    await fs.writeFile(path.join(baseOutputDir, 'style.css'), styleCssContent);
    console.log(`Created style.css in ${baseOutputDir}`);

    // Create index.php
    const packageName = themeName.replace(/\s+/g, ''); // e.g., ConvertedWPTheme
    const indexPhpContent = `<?php
/**
 * Main template file.
 *
 * @package ${packageName}
 */

block_template_part( 'index' );`;
    await fs.writeFile(path.join(baseOutputDir, 'index.php'), indexPhpContent);
    console.log(`Created index.php in ${baseOutputDir}`);

    // Create theme.json
    const themeJsonContent = `{
  "version": 2,
  "$schema": "https://schemas.wp.org/wp/6.3/theme.json"
}`;
    await fs.writeFile(path.join(baseOutputDir, 'theme.json'), themeJsonContent);
    console.log(`Created theme.json in ${baseOutputDir}`);

    // Create templates/ and parts/ directories
    await fs.ensureDir(path.join(baseOutputDir, 'templates'));
    console.log(`Created templates/ directory in ${baseOutputDir}`);
    await fs.ensureDir(path.join(baseOutputDir, 'parts'));
    console.log(`Created parts/ directory in ${baseOutputDir}`);

  } catch (err) {
    console.error('Error setting up theme directory:', err.message);
    process.exit(1);
  }
}

async function processHtmlFiles(cssAst) { // Accept cssAst
  try {
    // Check if the provided path is a directory
    const stats = await fs.stat(inputDir);
    if (!stats.isDirectory()) {
      console.error(`Error: The provided path "${inputDir}" is not a directory.`);
      process.exit(1);
    }

    const files = await fs.readdir(inputDir);
    const htmlFiles = files.filter(file => path.extname(file).toLowerCase() === '.html');

    if (htmlFiles.length === 0) {
      console.log(`No HTML files found in directory: ${inputDir}`);
      return;
    }

    console.log(`Found HTML files in ${inputDir}:`);
    let headerCandidates = {}; // Store HTML string -> count
    let footerCandidates = {}; // Store HTML string -> count
    let filesWithHeader = 0;
    let filesWithFooter = 0;
    const totalFiles = htmlFiles.length;

    if (totalFiles === 0) {
      console.log(`No HTML files found in directory: ${inputDir}`);
      await setupThemeDirectory(); // Still setup empty theme
      return;
    }

    console.log(`\n--- Pass 1: Collecting Header/Footer Candidates from ${totalFiles} files ---`);
    for (const htmlFile of htmlFiles) {
      const filePath = path.join(inputDir, htmlFile);
      try {
        const content = await fs.readFile(filePath, 'utf8');
        const $ = cheerio.load(content, { decodeEntities: false });

        const $body = $('body');
        const $headerElement = $body.children('header').first();
        if ($headerElement.length) {
          const headerHtml = $.html($headerElement);
          headerCandidates[headerHtml] = (headerCandidates[headerHtml] || 0) + 1;
          filesWithHeader++;
        }

        const $footerElement = $body.children('footer').last();
        if ($footerElement.length) {
          const footerHtml = $.html($footerElement);
          footerCandidates[footerHtml] = (footerCandidates[footerHtml] || 0) + 1;
          filesWithFooter++;
        }
      } catch (err) {
        console.error(`Error reading file ${htmlFile} during candidate collection:`, err.message);
      }
    }

    await identifyAndProcessCommonParts(headerCandidates, footerCandidates, totalFiles, filesWithHeader, filesWithFooter, cssAst); // Pass cssAst
    
    // Setup theme directory structure (must be done after common parts are identified and potentially saved)
    await setupThemeDirectory();

    console.log('\n--- Pass 2: Generating Templates and Inserting Template Part Tags (with style mapping) ---');
    for (const htmlFile of htmlFiles) {
      const filePath = path.join(inputDir, htmlFile);
      try {
        let content = await fs.readFile(filePath, 'utf8'); // Original full HTML content
        let $ = cheerio.load(content, { decodeEntities: false });

        // Replace common header HTML with template part tag
        if (commonHeaderOriginalHtml) {
          const $body = $('body');
          const $headerElement = $body.children(headerTagName).first(); // Use detected tag name
          if ($headerElement.length && $.html($headerElement) === commonHeaderOriginalHtml) {
            $headerElement.replaceWith(`<!-- wp:template-part {"slug":"header","tagName":"${headerTagName}"} /-->`);
            content = $.html(); // Get the modified full HTML
            $ = cheerio.load(content, { decodeEntities: false }); // Reload Cheerio with modified content
            console.log(`Replaced header in ${htmlFile} with template part tag.`);
          }
        }

        // Replace common footer HTML with template part tag
        if (commonFooterOriginalHtml) {
          const $body = $('body');
          const $footerElement = $body.children(footerTagName).last(); // Use detected tag name
          if ($footerElement.length && $.html($footerElement) === commonFooterOriginalHtml) {
            $footerElement.replaceWith(`<!-- wp:template-part {"slug":"footer","tagName":"${footerTagName}"} /-->`);
            content = $.html(); // Get the modified full HTML
            console.log(`Replaced footer in ${htmlFile} with template part tag.`);
          }
        }
        
        // Convert the (potentially modified) body content to block syntax
        const bodyBlockHtml = await convertHtmlToBlockSyntax(content, cssAst); // Pass cssAst

        const templateFileName = htmlFile;
        const outputFilePath = path.join(baseOutputDir, 'templates', templateFileName);
        await fs.writeFile(outputFilePath, bodyBlockHtml);
        console.log(`Saved final template to ${outputFilePath}`);

      } catch (err) {
        console.error(`Error processing file ${htmlFile} for final template generation:`, err.message);
      }
    }

  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error(`Error: Directory not found at path: ${inputDir}`);
    } else {
      console.error('Error processing files:', err.message);
    }
    process.exit(1);
  }
}

// Refactored block conversion logic
async function convertHtmlToBlockSyntax(fullHtmlContent, cssAst) { // Accept cssAst
    const $ = cheerio.load(fullHtmlContent, { decodeEntities: false });

    // If template part tags are already there, we want to preserve them.
    // The block conversion logic below operates on specific HTML tags (img, p, etc.)
    // It should not affect the wp:template-part comments if they are at the root of the body.

    // Process IMG elements
    $('body img').each((index, element) => { // Target only images within body
        const $element = $(element);
        if ($element.closest('figure.wp-block-image').length > 0) return;
        const src = $element.attr('src') || '';
        const alt = $element.attr('alt') || '';
        const wpImageBlock = `<!-- wp:image {"id":0,"sizeSlug":"large","linkDestination":"none"} --><figure class="wp-block-image size-large"><img src="${src}" alt="${alt}"/></figure><!-- /wp:image -->`;
        $element.replaceWith(wpImageBlock);
    });

    // Process LI elements
    $('body li').each((index, element) => {
        const $element = $(element);
        if (!$element.parent().is('ul') && !$element.parent().is('ol')) return;
        const prevSib = $element[0].prevSibling;
        const nextSib = $element[0].nextSibling;
        if (prevSib && prevSib.type === 'comment' && prevSib.data.trim() === 'wp:list-item' &&
            nextSib && nextSib.type === 'comment' && nextSib.data.trim() === '/wp:list-item') {
            return; 
        }
        const currentContent = $element.html();
        if (currentContent.startsWith('<!-- wp:list-item -->') && currentContent.endsWith('<!-- /wp:list-item -->')) {
            return;
        }
        const originalOuterHtml = $.html($element);
        $element.replaceWith(`<!-- wp:list-item -->${originalOuterHtml}<!-- /wp:list-item -->`);
    });

    // Process UL elements
    $('body ul').each((index, element) => {
        const $element = $(element);
        const prevSib = $element[0].prevSibling;
        const nextSib = $element[0].nextSibling;
        if (prevSib && prevSib.type === 'comment' && prevSib.data.trim() === 'wp:list' &&
            nextSib && nextSib.type === 'comment' && nextSib.data.trim() === '/wp:list') {
            return; 
        }
        $element.replaceWith(`<!-- wp:list -->${$.html($element)}<!-- /wp:list -->`);
    });

    // Process OL elements
    $('body ol').each((index, element) => {
        const $element = $(element);
        const prevSib = $element[0].prevSibling;
        const nextSib = $element[0].nextSibling;
        if (prevSib && prevSib.type === 'comment' && prevSib.data.trim() === 'wp:list {"ordered":true}' &&
            nextSib && nextSib.type === 'comment' && nextSib.data.trim() === '/wp:list') {
            return; 
        }
        $element.replaceWith(`<!-- wp:list {"ordered":true} -->${$.html($element)}<!-- /wp:list -->`);
    });

    // Process P elements
    $('body p').each((index, element) => {
        const $element = $(element);
        if ($element.closest('li').length > 0) return; 

        const attrs = {}; // Renamed to avoid conflict if attributes is used elsewhere
        const styles = findElementStyles($element, cssAst);

        if (styles['text-align']) {
            attrs.textAlign = styles['text-align'];
        }
        
        const textColorValue = styles['color'];
        if (textColorValue) {
            const textColorSlug = mapColorToPaletteSlug(textColorValue, globalThemeJsonData.settings.color.palette);
            if (textColorSlug) {
                attrs.textColor = textColorSlug;
                console.log(`Added textColor '${textColorSlug}' to paragraph (id: ${$element.attr('id') || 'none'}, class: ${$element.attr('class') || 'none'}).`);
            }
        }

        const backgroundColorValue = styles['background-color'];
        if (backgroundColorValue) {
            const bgColorSlug = mapColorToPaletteSlug(backgroundColorValue, globalThemeJsonData.settings.color.palette);
            if (bgColorSlug) {
                attrs.backgroundColor = bgColorSlug;
                console.log(`Added backgroundColor '${bgColorSlug}' to paragraph (id: ${$element.attr('id') || 'none'}, class: ${$element.attr('class') || 'none'}).`);
            }
        }

        const attributeString = Object.keys(attrs).length > 0 ? ` ${JSON.stringify(attrs)}` : '';
        const originalHtmlContent = $.html($element); 

        // Check if already wrapped (important due to DOM modifications)
        const prevSib = $element[0].prevSibling;
        const nextSib = $element[0].nextSibling;
        if (prevSib && prevSib.type === 'comment' && prevSib.data.trim() === `wp:paragraph${attributesString ? '' : ' '}`.trim() && // Complicated check due to attributes
            nextSib && nextSib.type === 'comment' && nextSib.data.trim() === '/wp:paragraph') {
             // This check needs to be more robust if attributes can change order or have different spacing
            return; 
        }
        
        $element.replaceWith(`<!-- wp:paragraph${attributesString} -->${originalHtmlContent}<!-- /wp:paragraph -->`);
    });

    // Process H1-H6 elements
    $('body h1, body h2, body h3, body h4, body h5, body h6').each((index, element) => {
        const $element = $(element);
        const tagName = $element.prop('tagName').toLowerCase();
        const level = parseInt(tagName.substring(1)); // Ensure level is an int
        
        const attrs = { level: level }; // Renamed to avoid conflict
        const styles = findElementStyles($element, cssAst);

        if (styles['text-align']) {
            attrs.textAlign = styles['text-align'];
        }

        const textColorValue = styles['color'];
        if (textColorValue) {
            const textColorSlug = mapColorToPaletteSlug(textColorValue, globalThemeJsonData.settings.color.palette);
            if (textColorSlug) {
                attrs.textColor = textColorSlug;
                console.log(`Added textColor '${textColorSlug}' to ${tagName.toUpperCase()} (id: ${$element.attr('id') || 'none'}, class: ${$element.attr('class') || 'none'}).`);
            }
        }

        const backgroundColorValue = styles['background-color'];
        if (backgroundColorValue) {
            const bgColorSlug = mapColorToPaletteSlug(backgroundColorValue, globalThemeJsonData.settings.color.palette);
            if (bgColorSlug) {
                attrs.backgroundColor = bgColorSlug;
                console.log(`Added backgroundColor '${bgColorSlug}' to ${tagName.toUpperCase()} (id: ${$element.attr('id') || 'none'}, class: ${$element.attr('class') || 'none'}).`);
            }
        }
        
        const attributeString = ` ${JSON.stringify(attrs)}`; // Headings always have 'level'
        const originalHtmlContent = $.html($element);

        // Check if already wrapped
        const prevSib = $element[0].prevSibling;
        const nextSib = $element[0].nextSibling;
         // Similar complex check for attributes needed here if we want to avoid re-processing.
         // For now, assuming this processing pass is the primary one for these attributes.
        if (prevSib && prevSib.type === 'comment' && prevSib.data.trim().startsWith('wp:heading') &&
            nextSib && nextSib.type === 'comment' && nextSib.data.trim() === '/wp:heading') {
            // More robust check would compare attributes if re-processing is a concern
            // return; 
        }

        $element.replaceWith(`<!-- wp:heading${attributesString} -->${originalHtmlContent}<!-- /wp:heading -->`);
    });
    
    // Process A elements (standalone links)
    $('body a').each((index, element) => {
        const $element = $(element);
        // Check if the anchor is already part of a block that handles its content (e.g. paragraph, heading, list item)
        // or if it's inside a wp:template-part comment (which means it's already processed as part of a common part)
        let parentCheck = $element.parent();
        let isInBlock = false;
        while(parentCheck.length && parentCheck.prop('tagName')?.toLowerCase() !== 'body') {
            const parentTagName = parentCheck.prop('tagName')?.toLowerCase();
            if (['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'figure', 'figcaption'].includes(parentTagName)) {
                isInBlock = true;
                break;
            }
            // Check if parent is a comment node and is a wp:template-part
            if(parentCheck[0].type === 'comment' && parentCheck[0].data?.trim().startsWith('wp:template-part')) {
                isInBlock = true;
                break;
            }
            parentCheck = parentCheck.parent();
        }
        if (isInBlock) return;

        // If it's a direct child of body or a div (and not already wrapped), then wrap in paragraph.
        const parentTag = $element.parent().prop('tagName')?.toLowerCase();
        if (parentTag === 'body' || parentTag === 'div') {
            const prevNode = $element[0].prevSibling;
            const nextNode = $element[0].nextSibling;
            if (!(prevNode && prevNode.type === 'comment' && prevNode.data.trim() === 'wp:paragraph' &&
                nextNode && nextNode.type === 'comment' && nextNode.data.trim() === '/wp:paragraph')) {
                 $element.replaceWith(`<!-- wp:paragraph -->${$.html($element)}<!-- /wp:paragraph -->`);
            }
        }
    });
    return $('body').html(); // Return only the content of the body
}

function findMostFrequent(items, totalSourceFiles, presenceCount, thresholdPercent = 0.75) {
    if (presenceCount === 0 || (presenceCount / totalSourceFiles) < thresholdPercent) {
        console.log(`Presence count (${presenceCount}/${totalSourceFiles}) for this element type is below threshold (${thresholdPercent * 100}%).`);
        return null; // Not present in enough files
    }

    let mostFrequentHtml = null;
    let maxCount = 0;

    for (const html in items) {
        if (items[html] > maxCount) {
            maxCount = items[html];
            mostFrequentHtml = html;
        }
    }

    // Check if this most frequent item itself meets the threshold among *files that had the element*
    if (mostFrequentHtml && (maxCount / presenceCount) >= thresholdPercent) {
        console.log(`Most frequent item (found in ${maxCount}/${presenceCount} instances) meets the threshold.`);
        return mostFrequentHtml;
    } else {
        if (mostFrequentHtml) {
          console.log(`Most frequent item (found in ${maxCount}/${presenceCount} instances) does NOT meet the threshold.`);
        } else {
          console.log("No items found to determine frequency.");
        }
        return null;
    }
}

// Helper to find styles for a given element (simplified)
function findElementStyles($element, cssAst) {
    const styles = {}; // This is the line that will be matched and replaced
    styles.unmappedStyles = []; // Initialize array for unmapped styles
    if (!cssAst) return styles;

    const id = $element.attr('id');
    const classes = ($element.attr('class') || '').split(/\s+/).filter(Boolean);

    const targetBorderProps = [
        'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
        'border-color', 'border-style', 'border-width',
        'border-top-color', 'border-top-style', 'border-top-width',
        'border-right-color', 'border-right-style', 'border-right-width',
        'border-bottom-color', 'border-bottom-style', 'border-bottom-width',
        'border-left-color', 'border-left-style', 'border-left-width'
    ];

    const targetPaddingProps = [
        'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left'
    ];

    const targetMarginProps = [
        'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left'
    ];

    const targetBoxShadowProps = ['box-shadow']; // New list for box-shadow

    cssAst.walkRules(rule => {
        let matched = false;
        // Check ID selector (e.g., #myId)
        if (id && rule.selector.includes(`#${id}`)) {
            matched = true;
        }
        // Check class selectors (e.g., .myClass) - very basic, matches if any class is in selector
        if (!matched && classes.length > 0) {
            if (classes.some(cls => rule.selector.includes(`.${cls}`))) {
                 // This is a weak match. A stronger match would parse rule.selectors properly.
                 // For now, we'll take it if it's a simple class selector like '.myClass'
                if (rule.selectors.some(s => classes.includes(s.substring(1)) && s.startsWith('.') && !s.includes(' ') && !s.includes(':'))) {
                    matched = true;
                }
            }
        }

        if (matched) {
            rule.walkDecls(decl => {
                if (decl.prop === 'text-align') {
                    styles['text-align'] = decl.value;
                } else if (decl.prop === 'background-color') {
                    styles['background-color'] = decl.value;
                } else if (decl.prop === 'color') {
                    styles['color'] = decl.value;
                } else if (targetBorderProps.includes(decl.prop)) {
                    styles.unmappedStyles.push({ property: decl.prop, value: decl.value });
                } else if (targetPaddingProps.includes(decl.prop)) { 
                    styles.unmappedStyles.push({ property: decl.prop, value: decl.value });
                } else if (targetMarginProps.includes(decl.prop)) {
                    styles.unmappedStyles.push({ property: decl.prop, value: decl.value });
                } else if (targetBoxShadowProps.includes(decl.prop)) { // New condition for box-shadow
                    styles.unmappedStyles.push({ property: decl.prop, value: decl.value });
                }
                // Add other properties to extract here later
            });
        }
    });
    return styles;
}


async function identifyAndProcessCommonParts(headerCandidates, footerCandidates, totalFiles, filesWithHeader, filesWithFooter, cssAst) { // Accept cssAst
    console.log('\n--- Identifying Common Header/Footer ---');
    const commonalityThreshold = 0.75; // 75% of files must have the element, and 75% of those must be identical.

    // Process Header
    commonHeaderOriginalHtml = findMostFrequent(headerCandidates, totalFiles, filesWithHeader, commonalityThreshold);
    if (commonHeaderOriginalHtml) {
        console.log('Common header HTML identified.');
        const $temp = cheerio.load(commonHeaderOriginalHtml);
        headerTagName = $temp.root().children().first().prop('tagName')?.toLowerCase() || 'header';

        commonHeaderBlockHtml = await convertHtmlToBlockSyntax(`<body>${commonHeaderOriginalHtml}</body>`, cssAst); // Pass cssAst
        const headerPartPath = path.join(baseOutputDir, 'parts', 'header.html');
        await fs.ensureDir(path.join(baseOutputDir, 'parts')); 
        await fs.writeFile(headerPartPath, commonHeaderBlockHtml);
        console.log(`Saved common header to ${headerPartPath}`);
    } else {
        console.log('No single common header found meeting the criteria.');
    }

    // Process Footer
    commonFooterOriginalHtml = findMostFrequent(footerCandidates, totalFiles, filesWithFooter, commonalityThreshold);
    if (commonFooterOriginalHtml) {
        console.log('Common footer HTML identified.');
        const $temp = cheerio.load(commonFooterOriginalHtml);
        footerTagName = $temp.root().children().first().prop('tagName')?.toLowerCase() || 'footer';

        commonFooterBlockHtml = await convertHtmlToBlockSyntax(`<body>${commonFooterOriginalHtml}</body>`, cssAst); // Pass cssAst
        const footerPartPath = path.join(baseOutputDir, 'parts', 'footer.html');
        await fs.ensureDir(path.join(baseOutputDir, 'parts'));
        await fs.writeFile(footerPartPath, commonFooterBlockHtml);
        console.log(`Saved common footer to ${footerPartPath}`);
    } else {
        console.log('No single common footer found meeting the criteria.');
    }
}

async function loadAndParseCss(providedCssDir) {
  if (!providedCssDir) {
    console.log('\nNo CSS directory provided (expected as 2nd argument). Skipping CSS analysis.');
    return null;
  }

  console.log(`\n--- Loading and Parsing CSS from: ${providedCssDir} ---`);
  try {
    const stats = await fs.stat(providedCssDir);
    if (!stats.isDirectory()) {
      console.error(`Error: The provided CSS path "${providedCssDir}" is not a directory.`);
      return null;
    }

    const cssFiles = (await fs.readdir(providedCssDir)).filter(file => path.extname(file).toLowerCase() === '.css');

    if (cssFiles.length === 0) {
      console.log(`No CSS files found in directory: ${providedCssDir}`);
      return null;
    }

    console.log('Found CSS files to process:');
    let combinedCss = '';
    for (const cssFile of cssFiles) {
      console.log(` - ${cssFile}`);
      const filePath = path.join(providedCssDir, cssFile);
      const content = await fs.readFile(filePath, 'utf8');
      combinedCss += content + '\n'; // Add newline to separate file contents
    }

    console.log('Attempting to parse combined CSS...');
    const result = await postcss().process(combinedCss, { from: undefined });
    console.log('Successfully parsed combined CSS into AST.');
    return result.root; // Return the PostCSS Root (AST)
  } catch (err) {
    console.error('Error loading or parsing CSS:', err.message);
    if (err.name === 'CssSyntaxError') {
        console.error('CSS Syntax Error Details:');
        console.error(err.showSourceCode(true));
    }
    return null;
  }
}

async function main() {
  let customClassCounter = 0; // Initialize custom class counter for each run
  // customClassCounter is global, initialized at the top.
  // Load CSS first to make AST available globally
  globalCssAst = await loadAndParseCss(cssDir); 
  if (globalCssAst) {
    console.log("\nGlobal CSS AST is available.");
  } else {
    console.log("\nCSS AST not generated or an error occurred during CSS processing.");
  }

  await processHtmlFiles(globalCssAst); // Process HTML, passing AST
  
  if (globalCssAst) { // If AST was loaded, proceed to update theme.json
    await updateThemeJsonWithCssAst(globalCssAst); 
  } else {
    console.log("\nSkipping theme.json update from CSS due to earlier errors or no CSS provided.");
  }

  // Log collected custom CSS rules (for next step)
  if (customCssRulesForStyleSheet.length > 0) {
    console.log("\n--- Collected Custom CSS Rules for style.css ---");
    customCssRulesForStyleSheet.forEach(rule => console.log(rule));
  }
}

async function updateThemeJsonWithCssAst(cssAst) { // cssAst is passed but globalThemeJsonData will be used
  console.log("\n--- Updating theme.json with extracted CSS styles ---");
  const themeJsonPath = path.join(baseOutputDir, 'theme.json');

  try {
    // Use globalThemeJsonData which should be populated by setupThemeDirectory or read here
    // For safety, read again if not populated, though it should be by setupThemeDirectory
    if (!globalThemeJsonData) {
        try {
            const themeJsonContent = await fs.readFile(themeJsonPath, 'utf8');
            globalThemeJsonData = JSON.parse(themeJsonContent);
        } catch (e) {
            if (e.code === 'ENOENT') {
                console.log('theme.json not found, will create a new one.');
                globalThemeJsonData = { version: 2, $schema: "https://schemas.wp.org/wp/6.3/theme.json" };
            } else {
                console.error('Error reading or parsing theme.json:', e.message);
                return; 
            }
        }
    }
    
    // Ensure globalThemeJsonData is not null before proceeding
    if (!globalThemeJsonData) {
        console.error("Failed to load or initialize theme.json data.");
        return;
    }

    // Initialize sections if not present
    globalThemeJsonData.settings = globalThemeJsonData.settings || {};
    globalThemeJsonData.settings.color = globalThemeJsonData.settings.color || {};
    globalThemeJsonData.settings.color.palette = globalThemeJsonData.settings.color.palette || [];
    globalThemeJsonData.settings.typography = globalThemeJsonData.settings.typography || {};
    globalThemeJsonData.settings.typography.fontFamilies = globalThemeJsonData.settings.typography.fontFamilies || [];
    globalThemeJsonData.settings.typography.fontSizes = globalThemeJsonData.settings.typography.fontSizes || [];
    globalThemeJsonData.settings.layout = globalThemeJsonData.settings.layout || {};

    globalThemeJsonData.styles = globalThemeJsonData.styles || {};
    globalThemeJsonData.styles.typography = globalThemeJsonData.styles.typography || {};
    globalThemeJsonData.styles.elements = globalThemeJsonData.styles.elements || {};

    const elementTags = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p'];
    elementTags.forEach(tag => {
      globalThemeJsonData.styles.elements[tag] = globalThemeJsonData.styles.elements[tag] || {};
      globalThemeJsonData.styles.elements[tag].typography = globalThemeJsonData.styles.elements[tag].typography || {};
    });
    
    console.log("CSS AST available, proceeding with style extraction for theme.json.");

    // 1. Extract Font Families
    const extractedFontFamilies = extractFontFamilies(cssAst); // cssAst is passed correctly
    if (extractedFontFamilies.length > 0) {
        const existingFontFamilyStrings = globalThemeJsonData.settings.typography.fontFamilies.map(f => f.fontFamily);
        extractedFontFamilies.forEach(font => {
            if (!existingFontFamilyStrings.includes(font.fontFamily)) {
                globalThemeJsonData.settings.typography.fontFamilies.push(font);
            }
        });
        console.log(`Processed ${extractedFontFamilies.length} font families for theme.json.`);
    }

    // 2. Extract Color Palette
    const extractedColors = extractColorPalette(cssAst); // cssAst is passed
     if (extractedColors.length > 0) {
        const existingColorValues = globalThemeJsonData.settings.color.palette.map(c => c.color);
        extractedColors.forEach(color => {
            if (!existingColorValues.includes(color.color)) {
                globalThemeJsonData.settings.color.palette.push(color);
            }
        });
        console.log(`Processed ${extractedColors.length} colors for theme.json palette.`);
    }

    // 3. Extract Typography Styles (Font Sizes for elements & global)
    const { globalFontSize, elementFontSizes } = extractTypographyStyles(cssAst); // cssAst is passed
    if (globalFontSize) {
        globalThemeJsonData.styles.typography.fontSize = globalFontSize;
        console.log(`Set global font size in theme.json: ${globalFontSize}`);
    }
    for (const tag in elementFontSizes) {
        if (Object.hasOwnProperty.call(elementFontSizes, tag)) {
            globalThemeJsonData.styles.elements[tag].typography.fontSize = elementFontSizes[tag];
            console.log(`Set font size for ${tag} in theme.json: ${elementFontSizes[tag]}`);
        }
    }
    
    // 4. Extract Layout (Content Width)
    const layoutSizes = extractLayoutSizes(cssAst); // cssAst is passed
    if (layoutSizes.contentSize) {
        globalThemeJsonData.settings.layout.contentSize = layoutSizes.contentSize;
        console.log(`Set layout.contentSize in theme.json: ${layoutSizes.contentSize}`);
    }
    if (layoutSizes.wideSize) {
        globalThemeJsonData.settings.layout.wideSize = layoutSizes.wideSize;
        console.log(`Set layout.wideSize in theme.json: ${layoutSizes.wideSize}`);
    }

    await fs.writeFile(themeJsonPath, JSON.stringify(globalThemeJsonData, null, 2));
    console.log(`Successfully updated theme.json at ${themeJsonPath}`);

  } catch (error) {
    console.error('Error updating theme.json:', error.message);
    if (error.stack) {
        console.error(error.stack);
    }
  }
}

// --- Helper functions for extraction (stubs for now) ---
function extractFontFamilies(cssAst) {
    const families = [];
    let counter = 1;
    cssAst.walkRules(rule => {
        // Prioritize body and html for global font families
        if (rule.selector.includes('body') || rule.selector.includes('html')) {
            rule.walkDecls('font-family', decl => {
                const familyString = decl.value;
                if (!families.find(f => f.fontFamily === familyString)) {
                    families.push({
                        fontFamily: familyString,
                        name: `Font ${counter}`, // Simple naming
                        slug: `font-${counter++}`
                    });
                }
            });
        }
    });
    // Fallback: any font-family declaration if body/html didn't yield any
    if (families.length === 0) {
        cssAst.walkDecls('font-family', decl => {
            const familyString = decl.value;
            if (!families.find(f => f.fontFamily === familyString)) {
                 families.push({
                    fontFamily: familyString,
                    name: `Font ${counter}`,
                    slug: `font-${counter++}`
                });
            }
        });
    }
    return families.slice(0, 5); // Limit to a few for now
}

function extractColorPalette(cssAst) {
    const colors = new Set();
    cssAst.walkDecls(decl => {
        if (decl.prop === 'color' || decl.prop === 'background-color') {
            // Basic regex for hex, rgb, rgba. Ignores keywords like 'red'.
            const colorMatch = decl.value.match(/(#[0-9a-fA-F]{3,6}|rgba?\([\d\s,.]+\))/);
            if (colorMatch) {
                colors.add(colorMatch[0]);
            }
        }
    });
    let counter = 1;
    return Array.from(colors).slice(0,10).map(color => ({ // Limit to 10 colors
        color: color,
        name: `Color ${counter}`,
        slug: `color-${counter++}`
    }));
}

function extractTypographyStyles(cssAst) {
    let globalFontSize = null;
    const elementFontSizes = {};
    const elementsToStyle = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

    cssAst.walkRules(rule => {
        if (rule.selector === 'body' || rule.selector === 'html') {
            rule.walkDecls('font-size', decl => {
                globalFontSize = decl.value; // Takes the last one specified if multiple
            });
        }
        elementsToStyle.forEach(tag => {
            // Simple selector check, doesn't handle complex selectors like 'body p' yet for element-specific.
            // This will find 'p', '.content p', etc. More specific selectors might override.
            if (rule.selector.split(',').some(sel => sel.trim().endsWith(tag) && !sel.trim().includes(' '))) {
                 rule.walkDecls('font-size', decl => {
                    elementFontSizes[tag] = decl.value;
                });
            }
        });
    });
    return { globalFontSize, elementFontSizes };
}

function extractLayoutSizes(cssAst) {
    let contentSize = null;
    let wideSize = null;
    // Heuristic: look for common container class names or IDs
    const commonContainerSelectors = ['.container', '.content-wrapper', '.main', '#content', '#main'];
    
    cssAst.walkRules(rule => {
        if (commonContainerSelectors.some(s => rule.selector.includes(s))) {
            rule.walkDecls('max-width', decl => {
                // Prefer larger max-widths as contentSize, could be more sophisticated
                if (!contentSize || parseInt(decl.value) > parseInt(contentSize)) {
                    contentSize = decl.value;
                }
            });
        }
    });

    if (contentSize) {
        // Basic wideSize: contentSize or slightly larger if possible (e.g. 1200px for 1000px content)
        // For now, just set it to contentSize. Can be refined.
        wideSize = contentSize; 
    }
    return { contentSize, wideSize };
}

/*
  Helper function to normalize CSS color values for consistent comparison and processing.
  Examples:
  normalizeColor('#FFF'); // -> '#ffffff'
  normalizeColor('#12345F'); // -> '#12345f'
  normalizeColor(' RGB(0, 0, 0) '); // -> 'rgb(0,0,0)'
  normalizeColor('rgba(255, 0, 0, 0.5)'); // -> 'rgba(255,0,0,0.5)'
  normalizeColor('Red'); // -> 'red'
*/
function normalizeColor(colorValue) {
    if (!colorValue || typeof colorValue !== 'string') {
        return null;
    }

    let normalized = colorValue.toLowerCase().trim();

    // Expand hex shorthand: #rgb -> #rrggbb
    if (normalized.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i)) {
        normalized = `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}`;
    }

    // Normalize rgb() and rgba() values: remove spaces, ensure lowercase 'rgb'/'rgba'
    const rgbMatch = normalized.match(/^rgb\((\s*\d+\s*,\s*\d+\s*,\s*\d+\s*)\)$/i);
    if (rgbMatch) {
        const values = rgbMatch[1].split(',').map(v => v.trim()).join(',');
        normalized = `rgb(${values})`;
    }

    const rgbaMatch = normalized.match(/^rgba\((\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*[\d.]+\s*)\)$/i);
    if (rgbaMatch) {
        const values = rgbaMatch[1].split(',').map(v => v.trim()).join(',');
        normalized = `rgba(${values})`;
    }
    
    // For named colors or other formats, just return the lowercased, trimmed version.
    // A more comprehensive solution might map named colors to hex, but that's out of scope here.
    return normalized;
}

/*
  Maps a CSS color value to a theme palette slug.
  It uses normalizeColor for consistent comparison.

  Example Palette:
  const examplePalette = [
    { "slug": "black", "color": "#000000", "name": "Black" },
    { "slug": "white", "color": "#FFFFFF", "name": "White" },
    { "slug": "primary", "color": "rgb(0, 0, 255)", "name": "Primary Blue" } 
  ];

  mapColorToPaletteSlug('#000', examplePalette); // -> "black"
  mapColorToPaletteSlug('rgb(255,255,255)', examplePalette); // -> "white"
  mapColorToPaletteSlug('blue', examplePalette); // -> "primary" (if normalizeColor handles 'blue' to 'rgb(0,0,255)' or if palette has 'blue')
                                                  // Current normalizeColor doesn't convert named colors to hex/rgb, so this would only work if palette also uses 'blue'.
  mapColorToPaletteSlug('#123456', examplePalette); // -> null
  mapColorToPaletteSlug(null, examplePalette); // -> null
  mapColorToPaletteSlug('#FF0000', null); // -> null
*/
function mapColorToPaletteSlug(colorValue, palette) {
    if (!colorValue || !palette || !Array.isArray(palette)) {
        return null;
    }

    const normalizedInputColor = normalizeColor(colorValue);
    if (!normalizedInputColor) {
        return null; // Invalid input color
    }

    for (const paletteEntry of palette) {
        if (paletteEntry && paletteEntry.color && typeof paletteEntry.slug === 'string') {
            const normalizedPaletteColor = normalizeColor(paletteEntry.color);
            if (normalizedPaletteColor === normalizedInputColor) {
                return paletteEntry.slug;
            }
        }
    }

    return null; // No match found
}

main();
          const $element = $(element);
          if ($element.closest('figure.wp-block-image').length > 0) return; // Already part of a wp:image block

          const src = $element.attr('src') || '';
          const alt = $element.attr('alt') || '';
          const wpImageBlock = `<!-- wp:image {"id":0,"sizeSlug":"large","linkDestination":"none"} --><figure class="wp-block-image size-large"><img src="${src}" alt="${alt}"/></figure><!-- /wp:image -->`;
          $element.replaceWith(wpImageBlock);
        });

        // Process LI elements
        $('li').each((index, element) => {
          const $element = $(element);
          if (!$element.parent().is('ul') && !$element.parent().is('ol')) return; // Only LIs in UL/OL

          const prevSib = $element[0].prevSibling;
          const nextSib = $element[0].nextSibling;
          if (prevSib && prevSib.type === 'comment' && prevSib.data.trim() === 'wp:list-item' &&
              nextSib && nextSib.type === 'comment' && nextSib.data.trim() === '/wp:list-item') {
            return; // Already wrapped
          }
          // Fallback for content already being comments (e.g. bad prior transform)
          const currentContent = $element.html();
          if (currentContent.startsWith('<!-- wp:list-item -->') && currentContent.endsWith('<!-- /wp:list-item -->')) {
              return;
          }
          
          const originalOuterHtml = $.html($element);
          $element.replaceWith(`<!-- wp:list-item -->${originalOuterHtml}<!-- /wp:list-item -->`);
        });

        // Process UL elements
        $('ul').each((index, element) => {
          const $element = $(element);
          const prevSib = $element[0].prevSibling;
          const nextSib = $element[0].nextSibling;
          if (prevSib && prevSib.type === 'comment' && prevSib.data.trim() === 'wp:list' &&
              nextSib && nextSib.type === 'comment' && nextSib.data.trim() === '/wp:list') {
            return; // Already wrapped
          }
          $element.replaceWith(`<!-- wp:list -->${$.html($element)}<!-- /wp:list -->`);
        });

        // Process OL elements
        $('ol').each((index, element) => {
          const $element = $(element);
          const prevSib = $element[0].prevSibling;
          const nextSib = $element[0].nextSibling;
          if (prevSib && prevSib.type === 'comment' && prevSib.data.trim() === 'wp:list {"ordered":true}' &&
              nextSib && nextSib.type === 'comment' && nextSib.data.trim() === '/wp:list') {
            return; // Already wrapped
          }
          $element.replaceWith(`<!-- wp:list {"ordered":true} -->${$.html($element)}<!-- /wp:list -->`);
        });

        // Process P elements
        $('p').each((index, element) => {
          const $element = $(element);
          // If a p is inside a list item, it should not be wrapped by wp:paragraph (WordPress handles this by default)
          if ($element.closest('li').length > 0) return;

          const prevSib = $element[0].prevSibling;
          const nextSib = $element[0].nextSibling;
          if (prevSib && prevSib.type === 'comment' && prevSib.data.trim() === 'wp:paragraph' &&
              nextSib && nextSib.type === 'comment' && nextSib.data.trim() === '/wp:paragraph') {
            return; // Already wrapped
          }
          $element.replaceWith(`<!-- wp:paragraph -->${$.html($element)}<!-- /wp:paragraph -->`);
        });

        // Process H1-H6 elements
        $('h1, h2, h3, h4, h5, h6').each((index, element) => {
          const $element = $(element);
          const tagName = $element.prop('tagName').toLowerCase();
          const level = tagName.substring(1);
          
          const prevSib = $element[0].prevSibling;
          const nextSib = $element[0].nextSibling;
          if (prevSib && prevSib.type === 'comment' && prevSib.data.trim() === `wp:heading {"level":${level}}` &&
              nextSib && nextSib.type === 'comment' && nextSib.data.trim() === '/wp:heading') {
            return; // Already wrapped
          }
          $element.replaceWith(`<!-- wp:heading {"level":${level}} -->${$.html($element)}<!-- /wp:heading -->`);
        });
        
        // Process A elements (standalone links)
        $('a').each((index, element) => {
            const $element = $(element);
            const parentTag = $element.parent().prop('tagName')?.toLowerCase();

            // Check if already wrapped by wp:paragraph
            const prevNode = $element[0].prevSibling;
            const nextNode = $element[0].nextSibling;
            if (prevNode && prevNode.type === 'comment' && prevNode.data.trim() === 'wp:paragraph' &&
                nextNode && nextNode.type === 'comment' && nextNode.data.trim() === '/wp:paragraph') {
                return; // Already wrapped as a paragraph
            }

            // If parent is p, h*, li, or another a, it's likely handled or part of accepted content.
            // Also, if it's inside a figure (e.g. wp:image can have links in its caption, which is a figcaption often).
            if (['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'a', 'figure', 'figcaption'].includes(parentTag)) {
                return;
            }
            
            // If it's a direct child of body or a div (common for grouping that isn't a block itself yet)
            // This also implies it's not inside any other block-level element we've processed.
            if (parentTag === 'body' || parentTag === 'div') {
                 $element.replaceWith(`<!-- wp:paragraph -->${$.html($element)}<!-- /wp:paragraph -->`);
            }
        });

        const transformedHtml = $('body').html(); // Get content of <body>
        
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.error(`Error: Directory not found at path: ${inputDir}`);
    } else {
      console.error('Error processing files:', err.message);
    }
    process.exit(1);
  }
}

processHtmlFiles();
