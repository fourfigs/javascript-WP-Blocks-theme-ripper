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
let globalKeyframesRules = []; // To store @keyframes rules
let globalAssetsToCopy = new Map(); // Using Map to store originalPath -> newThemePath
let usedThemePaths = new Set(); // To ensure unique asset paths in the theme
let customClassCounter = 0; // Counter for unique class names

if (!inputDir) {
  console.error('Error: Please provide an input HTML directory path as the first command-line argument.');
  process.exit(1);
}

async function setupThemeDirectory() {
  try {
    console.log(`Attempting to create theme directory at: ${baseOutputDir}`);
    await fs.remove(baseOutputDir);
    console.log(`Removed existing directory (if any): ${baseOutputDir}`);
    await fs.ensureDir(baseOutputDir);
    console.log(`Created theme directory: ${baseOutputDir}`);

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

    const packageName = themeName.replace(/\s+/g, '');
    const indexPhpContent = `<?php
/**
 * Main template file.
 * @package ${packageName}
 */
block_template_part( 'index' );`;
    await fs.writeFile(path.join(baseOutputDir, 'index.php'), indexPhpContent);
    console.log(`Created index.php in ${baseOutputDir}`);

    const themeJsonContent = `{
  "version": 2,
  "$schema": "https://schemas.wp.org/wp/6.3/theme.json",
  "settings": {
    "layout": {"contentSize": "800px", "wideSize": "1200px", "useRootPaddingAwareAlignments": true},
    "spacing": {"padding": true, "margin": true}
  },
  "styles": {
    "spacing": {"padding": {"top": "0", "right": "0", "bottom": "0", "left": "0"}}
  }
}`;
    await fs.writeFile(path.join(baseOutputDir, 'theme.json'), themeJsonContent);
    console.log('INFO: Initial theme.json created with FSE layout settings (contentSize, wideSize, useRootPaddingAwareAlignments).');
    try {
        globalThemeJsonData = JSON.parse(themeJsonContent);
        // Ensure essential structures exist for later processing stages
        globalThemeJsonData.settings = globalThemeJsonData.settings || {};
        globalThemeJsonData.settings.color = globalThemeJsonData.settings.color || {};
        globalThemeJsonData.settings.color.palette = globalThemeJsonData.settings.color.palette || [];
        globalThemeJsonData.settings.typography = globalThemeJsonData.settings.typography || {};
        globalThemeJsonData.settings.typography.fontFamilies = globalThemeJsonData.settings.typography.fontFamilies || [];
        globalThemeJsonData.settings.typography.fontSizes = globalThemeJsonData.settings.typography.fontSizes || [];
        console.log(`Created theme.json in ${baseOutputDir} and loaded into globalThemeJsonData with initial structures.`);
    } catch (e) {
        console.error('Error parsing initial theme.json content:', e.message);
        // Initialize globalThemeJsonData with a fallback structure if parsing fails, to prevent downstream errors
        globalThemeJsonData = { 
            settings: { 
                color: { palette: [] }, 
                typography: { fontFamilies: [], fontSizes: [] },
                layout: {}
            }, 
            styles: {} 
        };
        console.log('Initialized globalThemeJsonData with fallback structure due to parsing error.');
    }
    
    await fs.ensureDir(path.join(baseOutputDir, 'templates'));
    console.log(`Created templates/ directory in ${baseOutputDir}`);
    await fs.ensureDir(path.join(baseOutputDir, 'parts'));
    console.log(`Created parts/ directory in ${baseOutputDir}`);
  } catch (err) {
    console.error('Error setting up theme directory:', err.message);
    process.exit(1);
  }
}

async function processHtmlFiles(cssAst) {
  try {
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

    let headerCandidates = {}, footerCandidates = {};
    let filesWithHeader = 0, filesWithFooter = 0;
    const totalFiles = htmlFiles.length;

    console.log(`\n--- Pass 1: Collecting Header/Footer Candidates from ${totalFiles} files ---`);
    for (const htmlFile of htmlFiles) {
      const filePath = path.join(inputDir, htmlFile);
      try {
        const content = await fs.readFile(filePath, 'utf8');
        const $ = cheerio.load(content, { decodeEntities: false });
        const $body = $('body');
        const $headerElement = $body.children('header').first();
        if ($headerElement.length) {
          headerCandidates[$.html($headerElement)] = (headerCandidates[$.html($headerElement)] || 0) + 1;
          filesWithHeader++;
        }
        const $footerElement = $body.children('footer').last();
        if ($footerElement.length) {
          footerCandidates[$.html($footerElement)] = (footerCandidates[$.html($footerElement)] || 0) + 1;
          filesWithFooter++;
        }
      } catch (err) {
        console.error(`Error reading file ${htmlFile} during candidate collection:`, err.message);
      }
    }

    await identifyAndProcessCommonParts(headerCandidates, footerCandidates, totalFiles, filesWithHeader, filesWithFooter, cssAst);
    
    console.log('\n--- Pass 2: Generating Templates and Inserting Template Part Tags ---');
    for (const htmlFile of htmlFiles) {
      const filePath = path.join(inputDir, htmlFile);
      try {
        let content = await fs.readFile(filePath, 'utf8');
        let $ = cheerio.load(content, { decodeEntities: false });
        let $body = $('body');

        if (commonHeaderOriginalHtml) {
          const $headerElement = $body.children(headerTagName).first();
          if ($headerElement.length && $.html($headerElement) === commonHeaderOriginalHtml) {
            $headerElement.replaceWith(`<!-- wp:template-part {"slug":"header","tagName":"${headerTagName}"} /-->`);
          }
        }
        if (commonFooterOriginalHtml) {
          const $footerElement = $body.children(footerTagName).last();
          if ($footerElement.length && $.html($footerElement) === commonFooterOriginalHtml) {
            $footerElement.replaceWith(`<!-- wp:template-part {"slug":"footer","tagName":"${footerTagName}"} /-->`);
          }
        }
        
        const bodyContentForConversion = $('body').html();
        console.log(`DEBUG: For file ${htmlFile}, bodyContentForConversion is: "${bodyContentForConversion}"`);
        const bodyBlockHtml = await convertHtmlToBlockSyntax(bodyContentForConversion, cssAst, 'body', false, filePath); // navContext = false, pass filePath

        // bodyBlockHtml is a full HTML doc string (<html><body>...</body></html>) due to Cheerio's fragment processing.
        // We need to extract only the content of its effective <body> tag for the final template file.
        const $finalDoc = cheerio.load(bodyBlockHtml, { decodeEntities: false });
        const finalContentForFile = $finalDoc('body').html();
        console.log(`DEBUG: For file ${htmlFile}, finalContentForFile for template is: "${finalContentForFile}"`);

        const templateFileName = htmlFile;
        const outputFilePath = path.join(baseOutputDir, 'templates', templateFileName);
        await fs.writeFile(outputFilePath, finalContentForFile); // Write the extracted body content
        console.log(`Saved final template to ${outputFilePath}`);
      } catch (err) {
        console.error(`Error processing file ${htmlFile} for final template generation:`, err.message);
      }
    }
  } catch (err) {
    console.error('Error processing files:', err.message);
    process.exit(1);
  }
}

async function convertHtmlToBlockSyntax(htmlContentToConvert, cssAst, context = 'body', navContext = false, baseFilePath = null) {
    console.log(`[[convertHtmlToBlockSyntax START]] Context: ${context}, Input HTML: "${htmlContentToConvert}", NavContext: ${navContext}, BaseFilePath: ${baseFilePath}`);
    const trimmedHtmlContent = htmlContentToConvert.trim();
    console.log(`[[convertHtmlToBlockSyntax TRIMMED_INPUT]] "${trimmedHtmlContent}"`);

    // ALWAYS load as a fragment to avoid Cheerio's full document wrapping issues for body content
    const $ = cheerio.load(trimmedHtmlContent, { decodeEntities: false }, true); // Force isFragment = true
    
    try {
        // $ now directly represents the root of the parsed fragment.
        // Its children are the top-level elements from trimmedHtmlContent.
        // For consistency in the loop, we can still use a variable named $root, though it's just $ here.
        const $root = $; 
        console.log(`[[convertHtmlToBlockSyntax CHEERIO_LOADED_AS_FRAGMENT]] $root.html() initial: "${$root.html()}"`);

        // Process direct children first in specific order
        // Use a for...of loop to handle async operations within the loop correctly
        // When Cheerio loads a fragment that looks like body content, it wraps it in <html><body>...</body></html>.
        // We need to iterate over the children of this implicit <body> tag.
        for (const element of $.root().find('body').first().children().toArray()) { 
            console.log(`[[convertHtmlToBlockSyntax LOOP_ELEMENT]] TagName: ${$(element).prop('tagName')}, OuterHTML: ${$.html(element)}`);
            const $element = $(element);
            let processed = false; 
            let blockName = ''; 

            if ($element.is('img') && !$element.closest('figure.wp-block-image').length) {
                blockName = 'wp:image';
                let src = $element.attr('src') || '';
                const alt = $element.attr('alt') || '';
                
                if (src && !src.startsWith('data:') && !src.startsWith('http:') && !src.startsWith('https:') && !src.startsWith('//')) {
                    if (!baseFilePath) {
                        console.warn(`WARN: Cannot resolve asset path for image src "${src}" in content processed without a base file path (e.g. common parts).`);
                    } else {
                        const imageSourceDir = path.dirname(baseFilePath);
                        const resolvedOriginalPath = path.resolve(imageSourceDir, src);
                        
                        const assetFileName = path.basename(resolvedOriginalPath);
                        const assetTypeDir = 'images'; // For <img> tags
                        let targetName = assetFileName;
                        let counter = 0;
                        let newThemePath = `assets/${assetTypeDir}/${targetName}`;
                        while (usedThemePaths.has(newThemePath)) {
                          counter++;
                          targetName = `${path.parse(assetFileName).name}-${counter}${path.parse(assetFileName).ext}`;
                          newThemePath = `assets/${assetTypeDir}/${targetName}`;
                        }
                        usedThemePaths.add(newThemePath);
                        
                        globalAssetsToCopy.set(resolvedOriginalPath, newThemePath);
                        console.log(`INFO: Identified local image for copying: ${resolvedOriginalPath} -> ${newThemePath}. Updating src attribute.`);
                        src = newThemePath; // Update src to point to the new theme path
                    }
                } else if (src) {
                    console.log(`INFO: Skipping external or data URI image: ${src}`);
                }

                console.log(`INFO: Converting IMG (src: ${src}) to ${blockName}.`);
                const attrs = {"id":0,"sizeSlug":"large","linkDestination":"none"}; 
                console.log(`DEBUG: Applying to ${blockName}: attributes ${JSON.stringify(attrs)}`);
                $element.replaceWith(`<!-- wp:image ${JSON.stringify(attrs)} --><figure class="wp-block-image size-large"><img src="${src}" alt="${alt}"/></figure><!-- /wp:image -->`);
                processed = true;
            }
            else if ($element.is('li')) {
                if (navContext) {
                    const $a = $element.children('a').first();
                    if ($a.length) {
                        const label = $a.text();
                        const url = $a.attr('href') || '#';
                        const navLinkBlock = `<!-- wp:navigation-link {"label":"${label}","url":"${url}","kind":"custom","isTopLevelLink":true} /-->`;
                        console.log(`INFO: Converting LI > A to wp:navigation-link: ${label} -> ${url}`);
                        $element.replaceWith(navLinkBlock);
                    } else {
                        // Fallback for LI in NAV without A: process content, could be plain text or other blocks
                        const liContent = await convertHtmlToBlockSyntax($element.html(), cssAst, 'fragment', true, baseFilePath);
                        $element.replaceWith(liContent); // Replace LI with its processed content directly
                    }
                } else {
                    blockName = 'wp:list-item';
                    const listItemContent = await convertHtmlToBlockSyntax($element.html(), cssAst, 'fragment', false, baseFilePath);
                    console.log(`DEBUG: Applying to ${blockName}: (content only)`);
                    $element.replaceWith(`<!-- wp:list-item -->${listItemContent}<!-- /wp:list-item -->`);
                }
                processed = true;
            }
            else if ($element.is('ul') || $element.is('ol')) {
                if (navContext) {
                    // This UL/OL is inside a NAV. Its children (LIs) will be processed into nav items.
                    // The UL/OL element itself is replaced by the processed content of its children.
                    const navListContent = await convertHtmlToBlockSyntax($element.html(), cssAst, 'fragment', true, baseFilePath);
                    $element.replaceWith(navListContent);
                } else {
                    blockName = 'wp:list';
                    const attrs = {};
                    if ($element.is('ol')) attrs.ordered = true;
                    console.log(`INFO: Converting ${$element.prop('tagName').toUpperCase()} to ${blockName} ${attrs.ordered ? '(ordered)' : ''}.`);
                    
                    const listContent = await convertHtmlToBlockSyntax($element.html(), cssAst, 'fragment', false, baseFilePath);
                    const attributeString = Object.keys(attrs).length > 0 ? ` ${JSON.stringify(attrs)}` : '';
                    console.log(`DEBUG: Applying to ${blockName}: attributes ${JSON.stringify(attrs)}`);
                    $element.replaceWith(`<!-- wp:list${attributeString} -->${listContent}<!-- /wp:list -->`);
                }
                processed = true;
            }
            else if ($element.is('nav')) {
                blockName = 'core/navigation';
                console.log(`INFO: Converting NAV to ${blockName}.`);
                // Attributes for wp:navigation can be extensive (layout, colors, justification, etc.)
                // For now, we'll create a basic wrapper and process inner content.
                const navAttrs = {}; // Placeholder for future attribute extraction
                const navInnerBlocks = await convertHtmlToBlockSyntax($element.html(), cssAst, 'fragment', true, baseFilePath);
                const navAttrsString = Object.keys(navAttrs).length > 0 ? ` ${JSON.stringify(navAttrs)}` : '';
                $element.replaceWith(`<!-- wp:navigation${navAttrsString} -->${navInnerBlocks}<!-- /wp:navigation -->`);
                processed = true;
            }
            else if ($element.is('p')) {
                blockName = 'wp:paragraph';
                const attrs = {};
                const styleResults = findElementStyles($element, cssAst);
                if (styleResults.styles['text-align']) attrs.textAlign = styleResults.styles['text-align'];
                if (styleResults.directStyles && Object.keys(styleResults.directStyles).length > 0) attrs.style = styleResults.directStyles;
                if (styleResults.generatedClassName) attrs.className = styleResults.generatedClassName;
                const textColorValue = styleResults.styles['color'];
                if (textColorValue) {
                    const textColorSlug = mapColorToPaletteSlug(textColorValue, globalThemeJsonData.settings.color.palette);
                    if (textColorSlug) attrs.textColor = textColorSlug;
                }
                const backgroundColorValue = styleResults.styles['background-color'];
                if (backgroundColorValue) {
                    const bgColorSlug = mapColorToPaletteSlug(backgroundColorValue, globalThemeJsonData.settings.color.palette);
                    if (bgColorSlug) attrs.backgroundColor = bgColorSlug;
                }
                const attributeString = Object.keys(attrs).length > 0 ? ` ${JSON.stringify(attrs)}` : '';
                const pContent = await convertHtmlToBlockSyntax($element.html(), cssAst, 'fragment', false, baseFilePath);
                console.log(`DEBUG: Applying to ${blockName}: attributes ${JSON.stringify(attrs)}`);
                $element.replaceWith(`<!-- wp:paragraph${attributeString} -->${pContent}<!-- /wp:paragraph -->`);
                processed = true;
            }
            else if ($element.is('h1, h2, h3, h4, h5, h6')) {
                blockName = 'wp:heading';
                const level = parseInt($element.prop('tagName').substring(1));
                const attrs = { level: level };
                const styleResults = findElementStyles($element, cssAst);
                if (styleResults.styles['text-align']) attrs.textAlign = styleResults.styles['text-align'];
                if (styleResults.directStyles && Object.keys(styleResults.directStyles).length > 0) attrs.style = styleResults.directStyles;
                if (styleResults.generatedClassName) attrs.className = styleResults.generatedClassName;
                const textColorValue = styleResults.styles['color'];
                if (textColorValue) {
                    const textColorSlug = mapColorToPaletteSlug(textColorValue, globalThemeJsonData.settings.color.palette);
                    if (textColorSlug) attrs.textColor = textColorSlug;
                }
                const backgroundColorValue = styleResults.styles['background-color'];
                if (backgroundColorValue) {
                    const bgColorSlug = mapColorToPaletteSlug(backgroundColorValue, globalThemeJsonData.settings.color.palette);
                    if (bgColorSlug) attrs.backgroundColor = bgColorSlug;
                }
                const attributeString = ` ${JSON.stringify(attrs)}`;
                const hContent = await convertHtmlToBlockSyntax($element.html(), cssAst, 'fragment', false, baseFilePath);
                console.log(`DEBUG: Applying to ${blockName}: attributes ${JSON.stringify(attrs)}`);
                $element.replaceWith(`<!-- wp:heading${attributeString} -->${hContent}<!-- /wp:heading -->`);
                processed = true;
            }
            else if ($element.is('div, header, main, footer')) {
                blockName = 'wp:group';
                const actualTagName = $element.prop('tagName').toLowerCase();
                console.log(`INFO: Converting ${actualTagName.toUpperCase()} (id: ${$element.attr('id') || 'none'}, class: ${$element.attr('class') || 'none'}) to ${blockName}.`);
                const groupAttrs = { tagName: actualTagName };
                const styleResults = findElementStyles($element, cssAst);
                
                let newStyleObject = {}; // Initialize a new object for styles

                // Deep copy relevant parts of directStyles if they exist
                if (styleResults.directStyles) {
                    if (styleResults.directStyles.spacing) {
                        newStyleObject.spacing = JSON.parse(JSON.stringify(styleResults.directStyles.spacing));
                    }
                    if (styleResults.directStyles.border) {
                        newStyleObject.border = JSON.parse(JSON.stringify(styleResults.directStyles.border));
                    }
                    if (styleResults.directStyles.boxShadow) { // Assuming boxShadow is a simple value
                        newStyleObject.boxShadow = styleResults.directStyles.boxShadow;
                    }
                }

                if (styleResults.generatedClassName) {
                    groupAttrs.className = styleResults.generatedClassName; // Assign, don't append yet if it's the first
                }
                
                const backgroundColorValue = styleResults.styles['background-color'];
                if (backgroundColorValue) {
                    const bgColorSlug = mapColorToPaletteSlug(backgroundColorValue, globalThemeJsonData.settings.color.palette);
                    if (bgColorSlug) {
                        console.log(`[[DEBUG_GROUP_COLOR_SET]] Applying bgColorSlug '${bgColorSlug}' to ${actualTagName} '${$element.attr('id') || $element.attr('class') || ''}'`);
                        newStyleObject.color = newStyleObject.color || {};
                        newStyleObject.color.background = bgColorSlug;
                        console.log(`[[DEBUG_GROUP_COLOR_SET_AFTER]] newStyleObject.color for ${actualTagName} '${$element.attr('id') || $element.attr('class') || ''}': ${JSON.stringify(newStyleObject.color)}`);
                    } else { // Not a palette color
                        if (styleResults.generatedClassName) {
                            // findElementStyles created a class, which should cover this non-palette background-color.
                            // Ensure this class is added to groupAttrs.className if not already there from its first assignment.
                            if (groupAttrs.className === undefined || !groupAttrs.className.includes(styleResults.generatedClassName)) {
                                groupAttrs.className = (groupAttrs.className || '') + ` ${styleResults.generatedClassName}`;
                            }
                        } else {
                            // No general custom class from findElementStyles exists.
                            // Create a NEW specific class just for this background-color.
                            customClassCounter++;
                            const newBgClassName = `custom-style-${customClassCounter}`;
                            groupAttrs.className = (groupAttrs.className || '') + ` ${newBgClassName}`;
                            customCssRulesForStyleSheet.push(`.${newBgClassName} { background-color: ${backgroundColorValue}; }`);
                        }
                    }
                }
                const textColorValue = styleResults.styles['color'];
                if (textColorValue) {
                    const textColorSlug = mapColorToPaletteSlug(textColorValue, globalThemeJsonData.settings.color.palette);
                    if (textColorSlug) {
                        console.log(`[[DEBUG_GROUP_COLOR_SET]] Applying textColorSlug '${textColorSlug}' to ${actualTagName} '${$element.attr('id') || $element.attr('class') || ''}'`);
                        newStyleObject.color = newStyleObject.color || {};
                        newStyleObject.color.text = textColorSlug;
                        console.log(`[[DEBUG_GROUP_COLOR_SET_AFTER]] newStyleObject.color for ${actualTagName} '${$element.attr('id') || $element.attr('class') || ''}': ${JSON.stringify(newStyleObject.color)}`);
                    } else { // Not a palette color
                        if (styleResults.generatedClassName) {
                            // findElementStyles created a class, which should cover this non-palette text color.
                            // Ensure this class is added to groupAttrs.className if not already there.
                             if (groupAttrs.className === undefined || !groupAttrs.className.includes(styleResults.generatedClassName)) {
                                groupAttrs.className = (groupAttrs.className || '') + ` ${styleResults.generatedClassName}`;
                            }
                        } else {
                            // No general custom class from findElementStyles exists.
                            // Create a NEW specific class just for this text color.
                            customClassCounter++;
                            const newTextColorClassName = `custom-style-${customClassCounter}`;
                            groupAttrs.className = (groupAttrs.className || '') + ` ${newTextColorClassName}`;
                            groupAttrs.className = groupAttrs.className.trim();
                            customCssRulesForStyleSheet.push(`.${newTextColorClassName} { color: ${textColorValue}; }`);
                        }
                    }
                }
                if (groupAttrs.className) groupAttrs.className = groupAttrs.className.trim();

                if (groupAttrs.className) groupAttrs.className = groupAttrs.className.trim(); // Ensure trimming happens after all className additions

                if (groupAttrs.className) groupAttrs.className = groupAttrs.className.trim(); // Final trim for className

                const divContent = await convertHtmlToBlockSyntax($element.html(), cssAst, 'fragment', navContext, baseFilePath);
                
                // Create the attribute string FIRST, then log it.
                const groupAttributeString = Object.keys(groupAttrs).length > 0 ? ` ${JSON.stringify(groupAttrs)}` : '';
                
                console.log(`[[DEBUG_GROUP_ATTRS_FINAL_STRING]] For ${actualTagName} '${$element.attr('id') || $element.attr('class') || ''}': attributeString = ${groupAttributeString}`);
                
                // The old "Applying to" log will now just confirm what was in groupAttributeString
                console.log(`DEBUG: Applying to ${blockName}: attributes ${groupAttributeString}`); 
                $element.replaceWith(`<!-- wp:group${groupAttributeString} -->${divContent}<!-- /wp:group -->`);
                processed = true;
            }
            else if ($element.is('a') &&
                     !$element.parent().is('p, h1, h2, h3, h4, h5, h6, li') &&
                     !($element.parent().is('li') && $element.parent().parent().is('ul') && $element.parent().parent().parent().is('nav'))) { // Check if parent is li > ul > nav
                // Exclude <a> tags within a nav structure (nav > ul > li > a) as they'll be handled by 'li' for navs
                blockName = 'wp:paragraph';
                const pContent = await convertHtmlToBlockSyntax($.html($element), cssAst, 'fragment', false, baseFilePath);
                console.log(`DEBUG: Applying to ${blockName} (wrapping 'a'): (content only)`);
                $element.replaceWith(`<!-- wp:paragraph -->${pContent}<!-- /wp:paragraph -->`);
                processed = true;
            }
        } // End of for...of loop

        console.log(`[[convertHtmlToBlockSyntax PRE_RETURN]] $root.html() final: "${$root.html()}"`);
        const outputHtml = $root.html(); // Get HTML from the fragment root
        return outputHtml === null ? '' : outputHtml;

    } catch (err) {
        console.error(`ERROR in convertHtmlToBlockSyntax (context: ${context}): ${err.message}`, err.stack);
        return `<!-- HTML Conversion Error in context '${context}': ${err.message} -->`;
    }
}


function findMostFrequent(items, totalSourceFiles, presenceCount, thresholdPercent = 0.75) {
    if (presenceCount === 0 || (presenceCount / totalSourceFiles) < thresholdPercent) {
        return null;
    }
    let mostFrequentHtml = null;
    let maxCount = 0;
    for (const html in items) {
        if (items[html] > maxCount) {
            maxCount = items[html];
            mostFrequentHtml = html;
        }
    }
    if (mostFrequentHtml && (maxCount / presenceCount) >= thresholdPercent) {
        return mostFrequentHtml;
    }
    return null;
}

function findElementStyles($element, cssAst) {
    const collectedStyles = { id: {}, class: {}, tag: {} };
    const directStyles = { spacing: { padding: {}, margin: {} }, border: {} };
    let trulyUnmappedProperties = [];
    let generatedClassName = null;

    const id = $element.attr('id');
    const classes = ($element.attr('class') || '').split(/\s+/).filter(Boolean);
    const tagName = $element.prop('tagName')?.toLowerCase();

    if (!cssAst) return { styles: {}, directStyles: {}, generatedClassName };


    const spacingProperties = ['padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left'];
    const borderProperties = ['border', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-color', 'border-style', 'border-width', 'border-top-color', 'border-top-style', 'border-top-width', 'border-right-color', 'border-right-style', 'border-right-width', 'border-bottom-color', 'border-bottom-style', 'border-bottom-width', 'border-left-color', 'border-left-style', 'border-left-width'];
    const otherDirectlyMappable = ['box-shadow']; 

    cssAst.walkRules(rule => {
        let specificity = null;
        if (id && rule.selector.includes(`#${id}`)) specificity = 'id';
        else if (classes.length > 0 && classes.some(cls => rule.selectors.some(s => s === `.${cls}` || s.startsWith(`.${cls}.`) || s.startsWith(`.${cls}:`)))) specificity = 'class';
        else if (tagName && rule.selectors.some(s => s === tagName || s.startsWith(tagName + '.') || s.startsWith(tagName + ':'))) specificity = 'tag';

        if (specificity) {
            rule.walkDecls(decl => {
                if (!collectedStyles[specificity][decl.prop] || specificity === 'id' || (specificity === 'class' && !collectedStyles.id[decl.prop])) {
                     collectedStyles[specificity][decl.prop] = decl.value;
                }
            });
        }
    });
    
    const finalStyles = { ...collectedStyles.tag, ...collectedStyles.class, ...collectedStyles.id };

    for (const prop in finalStyles) {
        const value = finalStyles[prop];
        if (prop === 'background-color' || prop === 'color') {
            // Check if it's a palette color. If so, it will be handled by block-specific attributes, not a generic custom class.
            if (mapColorToPaletteSlug(value, globalThemeJsonData.settings.color.palette)) {
                continue; // Skip adding to trulyUnmappedProperties, will be handled by direct block color attributes
            }
            // If not a palette color, it will fall through to the 'else' and be added to trulyUnmappedProperties.
        }
        
        if (['text-align'].includes(prop)) { // text-align is directly mapped for some blocks
            // Potentially handle or ensure it's still captured if not mapped by a specific block
        } else if (spacingProperties.includes(prop)) {
            const [type, side] = prop.split('-');
            if (type === 'padding') directStyles.spacing.padding[side || 'all'] = value;
            else if (type === 'margin') directStyles.spacing.margin[side || 'all'] = value;
        } else if (borderProperties.includes(prop)) {
            if (prop === 'border') {
                const parts = value.match(/^([\d\w.]+)\s+(\w+)\s+(.+)$/);
                if (parts) {
                    directStyles.border.width = directStyles.border.width || parts[1];
                    directStyles.border.style = directStyles.border.style || parts[2];
                    directStyles.border.color = directStyles.border.color || parts[3];
                } else trulyUnmappedProperties.push({ property: prop, value: value });
            } else if (prop.startsWith('border-')) {
                const subProp = prop.substring('border-'.length);
                if (['color', 'width', 'style'].includes(subProp)) directStyles.border[subProp] = value;
                else trulyUnmappedProperties.push({ property: prop, value: value });
            }
        } else if (otherDirectlyMappable.includes(prop) && prop === 'box-shadow') {
            directStyles['boxShadow'] = value;
        } else {
            trulyUnmappedProperties.push({ property: prop, value: value });
        }
    }
    
    let directStylesApplied = false;
    if (Object.keys(directStyles.spacing.padding).length > 0) { directStylesApplied = true; } else { delete directStyles.spacing.padding; }
    if (Object.keys(directStyles.spacing.margin).length > 0) { directStylesApplied = true; } else { delete directStyles.spacing.margin; }
    if (Object.keys(directStyles.spacing).length === 0) { delete directStyles.spacing; }
    if (Object.keys(directStyles.border).length > 0) { directStylesApplied = true; } else { delete directStyles.border; }
    if (directStyles.boxShadow) { directStylesApplied = true; }


    if (directStylesApplied) {
         console.log(`DEBUG: Mapped direct style for element (${tagName}, id: ${id || 'none'}, class: ${classes.join('.') || 'none'}) -> ${JSON.stringify(directStyles)}`);
    }


    if (trulyUnmappedProperties.length > 0) {
        customClassCounter++;
        generatedClassName = `custom-style-${customClassCounter}`;
        const ruleString = trulyUnmappedProperties.map(style => `  ${style.property}: ${style.value};`).join('\n');
        customCssRulesForStyleSheet.push(`.${generatedClassName} {\n${ruleString}\n}`);
        console.log(`INFO: Generated custom class '${generatedClassName}' for element (${tagName}, id: ${id || 'none'}, class: ${classes.join('.') || 'none'}) with rules: ${ruleString}`);
    }
    
    return { styles: finalStyles, directStyles, generatedClassName };
}

async function processSingleCommonPart(headerOrFooterCandidates, totalFiles, filesWithElement, commonalityThreshold, partType, cssAst) {
    const originalHtml = findMostFrequent(headerOrFooterCandidates, totalFiles, filesWithElement, commonalityThreshold);
    let blockHtml = null;
    let originalTagName = partType; 

    if (originalHtml) {
        const $temp = cheerio.load(originalHtml, { decodeEntities: false }, false);
        const $rootElement = $temp.root().children().first();
        originalTagName = $rootElement.prop('tagName')?.toLowerCase() || (partType === 'header' ? 'header' : 'footer');
        
        const contentHtml = $rootElement.html();
        let processedContent = await convertHtmlToBlockSyntax(contentHtml, cssAst, 'fragment', false, null); // navContext=false, baseFilePath=null

        const groupAttrs = { tagName: originalTagName, layout: {type: "constrained"} };
        const styleResults = findElementStyles($rootElement, cssAst);

        if (styleResults.directStyles && Object.keys(styleResults.directStyles).length > 0) groupAttrs.style = styleResults.directStyles;
        if (styleResults.generatedClassName) groupAttrs.className = styleResults.generatedClassName;
        
        const bgColor = styleResults.styles['background-color'];
        if (bgColor) {
            const slug = mapColorToPaletteSlug(bgColor, globalThemeJsonData.settings.color.palette);
            if (slug) groupAttrs.backgroundColor = slug;
        }
        const textColor = styleResults.styles['color'];
        if (textColor) {
            const slug = mapColorToPaletteSlug(textColor, globalThemeJsonData.settings.color.palette);
            if (slug) groupAttrs.textColor = slug;
        }
        
        blockHtml = `<!-- wp:group ${JSON.stringify(groupAttrs)} -->${processedContent}<!-- /wp:group -->`;
        
        const partPath = path.join(baseOutputDir, 'parts', `${partType}.html`);
        await fs.ensureDir(path.join(baseOutputDir, 'parts')); 
        await fs.writeFile(partPath, blockHtml);
        console.log(`INFO: Common ${partType} found. Original tag: <${originalTagName}>. Saved to parts/${partType}.html and wrapped in wp:group.`);
    } else {
        console.log(`INFO: No single common ${partType} found meeting the criteria.`);
    }
    return { originalHtml, blockHtml, tagName: originalTagName };
}

async function identifyAndProcessCommonParts(headerCandidates, footerCandidates, totalFiles, filesWithHeader, filesWithFooter, cssAst) {
    const headerResult = await processSingleCommonPart(headerCandidates, totalFiles, filesWithHeader, 0.75, 'header', cssAst);
    commonHeaderOriginalHtml = headerResult.originalHtml;
    commonHeaderBlockHtml = headerResult.blockHtml;
    headerTagName = headerResult.tagName;

    const footerResult = await processSingleCommonPart(footerCandidates, totalFiles, filesWithFooter, 0.75, 'footer', cssAst);
    commonFooterOriginalHtml = footerResult.originalHtml;
    commonFooterBlockHtml = footerResult.blockHtml;
    footerTagName = footerResult.tagName;
}


async function loadAndParseCss(providedCssDir) {
  if (!providedCssDir) {
    console.log('\nNo CSS directory provided. Skipping CSS analysis.');
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
    let combinedCss = '';
    for (const cssFile of cssFiles) {
      const filePath = path.join(providedCssDir, cssFile);
      combinedCss += await fs.readFile(filePath, 'utf8') + '\n';
    }
    const result = await postcss().process(combinedCss, { from: undefined });
    console.log('Successfully parsed combined CSS into AST.');
    
    const propertiesToCheck = ['background-image', 'background', 'list-style-image', 'border-image', 'content', 'src']; // Added 'src' for @font-face

    // Helper function to process declarations for asset rewriting
    const processDeclaration = (decl) => {
        if (!propertiesToCheck.includes(decl.prop) && !(decl.parent.type === 'atrule' && decl.parent.name === 'font-face' && decl.prop === 'src')) {
            return;
        }

        const originalValue = decl.value;
        let modifiedValue = originalValue;

        // More specific regex: url\(["']?([^)"']+)["']?\)
        // This captures the path without quotes, and handles optional quotes.
        const urlRegex = /url\((['"]?)([^)'"]+)\1\)/g; // \1 matches the first capturing group (quote type)
        let match;

        // Loop to handle multiple url() instances in a single declaration value
        while ((match = urlRegex.exec(originalValue)) !== null) {
            const fullMatch = match[0]; // e.g., url('../images/foo.png') or url(images/bar.jpg)
            let extractedPath = match[2].trim(); // e.g., ../images/foo.png or images/bar.jpg

            if (!extractedPath || extractedPath.startsWith('data:') || extractedPath.startsWith('http:') || extractedPath.startsWith('https:') || extractedPath.startsWith('//')) {
                console.log(`INFO: Skipping external, data URI, or empty CSS asset path: ${extractedPath} in ${decl.prop}`);
                continue;
            }

            let resolvedOriginalPath;
            let cssFileDir;

            if (decl.source && decl.source.input && decl.source.input.file) {
                cssFileDir = path.dirname(decl.source.input.file || cssDir);
                if (!decl.source.input.file) {
                     console.warn(`WARN: Could not reliably determine original CSS file for asset path "${extractedPath}" in property "${decl.prop}". Resolving relative to input CSS directory "${cssDir}".`);
                }
                 resolvedOriginalPath = path.resolve(cssFileDir, extractedPath);
            } else {
                console.warn(`WARN: Missing source information for asset path "${extractedPath}" in property "${decl.prop}". Resolving relative to input CSS directory "${cssDir}".`);
                resolvedOriginalPath = path.resolve(cssDir, extractedPath);
            }
            
            const assetFileName = path.basename(resolvedOriginalPath);
            const assetTypeDir = (decl.parent.type === 'atrule' && decl.parent.name === 'font-face' && decl.prop === 'src') ? 'fonts' : 'images';
            
            let targetName = assetFileName;
            let counter = 0;
            let newThemePath = `assets/${assetTypeDir}/${targetName}`; // This is relative to theme root
            while (usedThemePaths.has(newThemePath)) {
              counter++;
              targetName = `${path.parse(assetFileName).name}-${counter}${path.parse(assetFileName).ext}`;
              newThemePath = `assets/${assetTypeDir}/${targetName}`;
            }
            usedThemePaths.add(newThemePath);

            if (!globalAssetsToCopy.has(resolvedOriginalPath)) {
                globalAssetsToCopy.set(resolvedOriginalPath, newThemePath);
                console.log(`INFO: Identified local CSS asset for copying: ${resolvedOriginalPath} -> ${newThemePath} (from ${decl.prop}: ${originalValue})`);
            }
            
            // Rewrite the path in the declaration's value
            // Ensure newThemePath is relative to the CSS file for url() context if style.css is in root.
            // Since our style.css is at the root, newThemePath which is like 'assets/images/file.png' is correct.
            const replacementUrl = `url('${newThemePath}')`; // Always add quotes for consistency
            modifiedValue = modifiedValue.replace(fullMatch, replacementUrl);
            console.log(`INFO: Rewriting CSS url in ${decl.prop}: ${fullMatch} -> ${replacementUrl}`);
        }

        if (modifiedValue !== originalValue) {
            decl.value = modifiedValue;
        }
    };

    // Process all declarations in the AST (including those not in @keyframes)
    result.root.walkDecls(processDeclaration);

    // Process declarations within @keyframes rules and then store the stringified rule
    globalKeyframesRules = []; // Reset before processing
    result.root.walkAtRules('keyframes', atRuleKeyframes => {
        atRuleKeyframes.walkDecls(processDeclaration); // Process declarations within this specific keyframe rule
        globalKeyframesRules.push(atRuleKeyframes.toString());
    });
    console.log(`INFO: Found and stored ${globalKeyframesRules.length} @keyframes rules (with paths rewritten).`);
    
    return result.root;
  } catch (err) {
    console.error('Error loading or parsing CSS:', err.message);
    return null;
  }
}

async function copyAssetsToTheme() {
  if (globalAssetsToCopy.size === 0) {
    console.log("INFO: No assets identified for copying.");
    return;
  }
  console.log(`INFO: Attempting to copy ${globalAssetsToCopy.size} assets to theme...`);
  // Ensure baseOutputDir is accessible, e.g., passed as param or global
  const themeAssetsDir = path.join(baseOutputDir, 'assets'); // General assets dir

  try {
    await fs.ensureDir(themeAssetsDir); // Ensure base assets/ dir exists
    // No need to pre-create assets/images and assets/fonts if newThemePath includes them.
  } catch (err) {
    console.error("ERROR: Could not create base asset directory:", err.message);
    return;
  }

  for (const [resolvedOriginalPath, newThemePath] of globalAssetsToCopy) {
    const fullTargetPath = path.join(baseOutputDir, newThemePath);
    try {
      await fs.ensureDir(path.dirname(fullTargetPath)); // Ensure specific subdir like assets/images exists
      await fs.copy(resolvedOriginalPath, fullTargetPath);
      console.log(`INFO: Copied asset: ${resolvedOriginalPath} -> ${fullTargetPath}`);
    } catch (err) {
      console.error(`ERROR: Could not copy asset ${resolvedOriginalPath} to ${fullTargetPath}:`, err.message);
      // Optionally, continue with other assets
    }
  }
}

async function main() {
  await setupThemeDirectory();
  globalCssAst = await loadAndParseCss(cssDir);
  if (!globalCssAst) console.log("CSS AST not generated or an error occurred.");
  
  await processHtmlFiles(globalCssAst);
  
  if (globalCssAst) await updateThemeJsonWithCssAst(globalCssAst);
  else console.log("\nSkipping theme.json update from CSS.");

  if (customCssRulesForStyleSheet.length > 0) {
    await appendCustomStylesToStyleCss();
  }
  await copyAssetsToTheme(); // Add this line
  console.log("\nConversion process complete."); // Existing log
}

async function appendCustomStylesToStyleCss() {
  const styleCssPath = path.join(baseOutputDir, 'style.css');
  let contentToAppend = ""; // Initialize empty string to build content

  // Handle @keyframes rules
  if (globalKeyframesRules && globalKeyframesRules.length > 0) {
    console.log(`INFO: Preparing to append ${globalKeyframesRules.length} @keyframes rules to style.css.`);
    contentToAppend += "\n\n/* @keyframes rules */\n";
    contentToAppend += globalKeyframesRules.join("\n\n"); // Add each keyframe rule, separated by a blank line
    contentToAppend += "\n"; // Add a newline after the block of keyframes
  }

  // Handle custom style rules
  if (customCssRulesForStyleSheet && customCssRulesForStyleSheet.length > 0) {
    console.log(`INFO: Preparing to append ${customCssRulesForStyleSheet.length} custom style rules to style.css.`);
    contentToAppend += "\n\n/* Custom styles from converter */\n";
    contentToAppend += customCssRulesForStyleSheet.join("\n"); // Add each custom style rule
    // contentToAppend += "\n"; // Optional: add a final newline after all custom styles
  }

  // Only proceed if there's something to append
  if (contentToAppend === "") {
    console.log("INFO: No custom styles or keyframes to append to style.css.");
    return; // Exit if nothing to do
  }

  try {
    await fs.appendFile(styleCssPath, contentToAppend);
    console.log(`Successfully appended styles and/or keyframes to ${styleCssPath}`);
  } catch (err) {
    console.error('Error appending custom styles to style.css:', err.message);
  }
}

async function updateThemeJsonWithCssAst(cssAst) {
  console.log("\n--- Updating theme.json with extracted CSS styles ---");
  const themeJsonPath = path.join(baseOutputDir, 'theme.json');
  try {
    if (!globalThemeJsonData) { // Should be loaded by setupThemeDirectory
        const themeJsonContent = await fs.readFile(themeJsonPath, 'utf8');
        globalThemeJsonData = JSON.parse(themeJsonContent);
    }
    globalThemeJsonData.settings = globalThemeJsonData.settings || {};
    globalThemeJsonData.settings.color = globalThemeJsonData.settings.color || {};
    globalThemeJsonData.settings.color.palette = globalThemeJsonData.settings.color.palette || [];
    globalThemeJsonData.settings.typography = globalThemeJsonData.settings.typography || {};
    globalThemeJsonData.settings.typography.fontFamilies = globalThemeJsonData.settings.typography.fontFamilies || [];
    // Ensure fontSizes array exists for potential future use, though not populated by current extractors
    globalThemeJsonData.settings.typography.fontSizes = globalThemeJsonData.settings.typography.fontSizes || []; 
    globalThemeJsonData.settings.layout = globalThemeJsonData.settings.layout || {};

    globalThemeJsonData.styles = globalThemeJsonData.styles || {};
    globalThemeJsonData.styles.typography = globalThemeJsonData.styles.typography || {};
    globalThemeJsonData.styles.elements = globalThemeJsonData.styles.elements || {};
    ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p'].forEach(tag => {
      globalThemeJsonData.styles.elements[tag] = globalThemeJsonData.styles.elements[tag] || {};
      globalThemeJsonData.styles.elements[tag].typography = globalThemeJsonData.styles.elements[tag].typography || {};
    });

    const extractedFontFamilies = extractFontFamilies(cssAst);
    if (extractedFontFamilies.length > 0) {
        const existingFontSlugs = new Set(globalThemeJsonData.settings.typography.fontFamilies.map(f => f.slug));
        extractedFontFamilies.forEach(font => {
            if (!existingFontSlugs.has(font.slug)) {
                globalThemeJsonData.settings.typography.fontFamilies.push(font);
            }
        });
        console.log(`INFO: Extracted font families for theme.json: ${JSON.stringify(globalThemeJsonData.settings.typography.fontFamilies)}`);
    }

    const extractedColors = extractColorPalette(cssAst);
    if (extractedColors.length > 0) {
        const existingColorValues = new Set(globalThemeJsonData.settings.color.palette.map(c => c.color));
        extractedColors.forEach(color => {
            if (!existingColorValues.has(color.color)) {
                globalThemeJsonData.settings.color.palette.push(color);
            }
        });
        console.log(`INFO: Extracted color palette for theme.json: ${JSON.stringify(globalThemeJsonData.settings.color.palette)}`);
    }
    
    const { globalFontSize, elementFontSizes } = extractTypographyStyles(cssAst);
    if (globalFontSize || Object.keys(elementFontSizes).length > 0) {
        if (globalFontSize) globalThemeJsonData.styles.typography.fontSize = globalFontSize;
        for (const tag in elementFontSizes) {
            globalThemeJsonData.styles.elements[tag].typography.fontSize = elementFontSizes[tag];
        }
        console.log(`INFO: Applied typography styles to theme.json (globalFontSize, elementFontSizes).`);
    }

    const layoutSizes = extractLayoutSizes(cssAst);
    if (layoutSizes.contentSize || layoutSizes.wideSize) {
        if(layoutSizes.contentSize) globalThemeJsonData.settings.layout.contentSize = layoutSizes.contentSize;
        if(layoutSizes.wideSize) globalThemeJsonData.settings.layout.wideSize = layoutSizes.wideSize;
        console.log(`INFO: Applied layout sizes to theme.json (contentSize, wideSize).`);
    }

    await fs.writeFile(themeJsonPath, JSON.stringify(globalThemeJsonData, null, 2));
    console.log(`Successfully updated theme.json at ${themeJsonPath}`);
  } catch (error) {
    console.error('Error updating theme.json:', error.message);
  }
}

function extractFontFamilies(cssAst) {
    const families = new Map(); 
    let counter = 1;
    cssAst.walkDecls('font-family', decl => {
        const familyString = decl.value;
        if (!families.has(familyString)) {
            families.set(familyString, {
                fontFamily: familyString, name: `Font ${counter}`, slug: `font-${counter++}`
            });
        }
    });
    return Array.from(families.values()).slice(0, 5);
}

function extractColorPalette(cssAst) {
    const colors = new Map();
    let counter = 1;
    cssAst.walkDecls(/^(color|background-color)$/, decl => {
        const colorMatch = decl.value.match(/(#[0-9a-fA-F]{3,6}|rgba?\([\d\s,.]+\)|hsls?\([\d\s%,.]+\))/);
        if (colorMatch) {
            const normalizedColor = normalizeColor(colorMatch[0]);
            if (normalizedColor && !colors.has(normalizedColor)) {
                colors.set(normalizedColor, {
                    color: normalizedColor, name: `Color ${counter}`, slug: `color-${counter++}`
                });
            }
        }
    });
    return Array.from(colors.values()).slice(0, 10);
}

function extractTypographyStyles(cssAst) {
    let globalFontSize = null;
    const elementFontSizes = {};
    const elementsToStyle = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
    cssAst.walkRules(rule => {
        if (rule.selector === 'body' || rule.selector === 'html') {
            rule.walkDecls('font-size', decl => { globalFontSize = decl.value; });
        }
        elementsToStyle.forEach(tag => {
            if (rule.selector.split(',').some(sel => sel.trim().endsWith(tag) && !sel.trim().includes(' '))) {
                 rule.walkDecls('font-size', decl => { elementFontSizes[tag] = decl.value; });
            }
        });
    });
    return { globalFontSize, elementFontSizes };
}

function extractLayoutSizes(cssAst) {
    let contentSize = null; let wideSize = null;
    const commonContainerSelectors = ['.container', '.content-wrapper', '.main', '#content', '#main'];
    cssAst.walkRules(rule => {
        if (commonContainerSelectors.some(s => rule.selector.includes(s))) {
            rule.walkDecls('max-width', decl => {
                if (!contentSize || parseInt(decl.value) > parseInt(contentSize)) {
                    contentSize = decl.value;
                }
            });
        }
    });
    if (contentSize) wideSize = contentSize; // Basic assumption
    return { contentSize, wideSize };
}

function normalizeColor(colorValue) {
    if (!colorValue || typeof colorValue !== 'string') return null;
    let normalized = colorValue.toLowerCase().trim();
    if (normalized.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i)) {
        normalized = `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}`;
    }
    const rgbMatch = normalized.match(/^rgb\((\s*\d+\s*,\s*\d+\s*,\s*\d+\s*)\)$/i);
    if (rgbMatch) normalized = `rgb(${rgbMatch[1].split(',').map(v => v.trim()).join(',')})`;
    const rgbaMatch = normalized.match(/^rgba\((\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*[\d.]+\s*)\)$/i);
    if (rgbaMatch) normalized = `rgba(${rgbaMatch[1].split(',').map(v => v.trim()).join(',')})`;
    return normalized;
}

function mapColorToPaletteSlug(colorValue, palette) {
    if (!colorValue || !palette || !Array.isArray(palette)) return null;
    const normalizedInputColor = normalizeColor(colorValue);
    if (!normalizedInputColor) return null;
    for (const paletteEntry of palette) {
        if (paletteEntry && paletteEntry.color && normalizeColor(paletteEntry.color) === normalizedInputColor) {
            return paletteEntry.slug;
        }
    }
    return null;
}

main();
