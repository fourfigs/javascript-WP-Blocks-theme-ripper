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
        console.log(`Created theme.json in ${baseOutputDir} and loaded into globalThemeJsonData`);
    } catch (e) {
        console.error('Error parsing initial theme.json content:', e.message);
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
        const bodyBlockHtml = await convertHtmlToBlockSyntax(bodyContentForConversion, cssAst, 'body');


        const templateFileName = htmlFile;
        const outputFilePath = path.join(baseOutputDir, 'templates', templateFileName);
        await fs.writeFile(outputFilePath, bodyBlockHtml);
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

async function convertHtmlToBlockSyntax(htmlContentToConvert, cssAst, context = 'body') {
    console.log(`[[convertHtmlToBlockSyntax START]] Context: ${context}, Input HTML: "${htmlContentToConvert}"`);
    // Determine if the content is a fragment or a full body
    const isFragment = context !== 'body';
    const $ = cheerio.load(htmlContentToConvert, { decodeEntities: false }, isFragment); 
    
    try {
        const $root = isFragment ? $ : $('body');
        console.log(`[[convertHtmlToBlockSyntax CHEERIO_LOADED]] $root.html() initial: "${$root.html()}"`);

        // Process direct children first in specific order
        // Use a for...of loop to handle async operations within the loop correctly
        for (const element of $root.children().toArray()) {
            console.log(`[[convertHtmlToBlockSyntax LOOP_ELEMENT]] TagName: ${$(element).prop('tagName')}, OuterHTML: ${$.html(element)}`);
            const $element = $(element);
            let processed = false; 
            let blockName = ''; 

            if ($element.is('img') && !$element.closest('figure.wp-block-image').length) {
                blockName = 'wp:image';
                console.log(`INFO: Converting IMG (src: ${$element.attr('src')}) to ${blockName}.`);
                const src = $element.attr('src') || '';
                const alt = $element.attr('alt') || '';
                const attrs = {"id":0,"sizeSlug":"large","linkDestination":"none"}; 
                console.log(`DEBUG: Applying to ${blockName}: attributes ${JSON.stringify(attrs)}`);
                $element.replaceWith(`<!-- wp:image ${JSON.stringify(attrs)} --><figure class="wp-block-image size-large"><img src="${src}" alt="${alt}"/></figure><!-- /wp:image -->`);
                processed = true;
            }
            else if ($element.is('li')) {
                blockName = 'wp:list-item';
                const listItemContent = await convertHtmlToBlockSyntax($element.html(), cssAst, 'fragment');
                console.log(`DEBUG: Applying to ${blockName}: (content only)`);
                $element.replaceWith(`<!-- wp:list-item -->${listItemContent}<!-- /wp:list-item -->`);
                processed = true;
            }
            else if ($element.is('ul') || $element.is('ol')) {
                blockName = 'wp:list';
                const attrs = {};
                if ($element.is('ol')) attrs.ordered = true;
                console.log(`INFO: Converting ${$element.prop('tagName').toUpperCase()} to ${blockName} ${attrs.ordered ? '(ordered)' : ''}.`);
                
                const listContent = await convertHtmlToBlockSyntax($element.html(), cssAst, 'fragment');
                const attributeString = Object.keys(attrs).length > 0 ? ` ${JSON.stringify(attrs)}` : '';
                console.log(`DEBUG: Applying to ${blockName}: attributes ${JSON.stringify(attrs)}`);
                $element.replaceWith(`<!-- wp:list${attributeString} -->${listContent}<!-- /wp:list -->`);
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
                const pContent = await convertHtmlToBlockSyntax($element.html(), cssAst, 'fragment');
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
                const hContent = await convertHtmlToBlockSyntax($element.html(), cssAst, 'fragment');
                console.log(`DEBUG: Applying to ${blockName}: attributes ${JSON.stringify(attrs)}`);
                $element.replaceWith(`<!-- wp:heading${attributeString} -->${hContent}<!-- /wp:heading -->`);
                processed = true;
            }
            else if ($element.is('div')) {
                blockName = 'wp:group';
                console.log(`INFO: Converting DIV (id: ${$element.attr('id') || 'none'}, class: ${$element.attr('class') || 'none'}) to ${blockName}.`);
                const groupAttrs = { tagName: 'div' };
                const styleResults = findElementStyles($element, cssAst);
                if (styleResults.directStyles && Object.keys(styleResults.directStyles).length > 0) groupAttrs.style = styleResults.directStyles;
                if (styleResults.generatedClassName) groupAttrs.className = (groupAttrs.className || '') + ` ${styleResults.generatedClassName}`;
                
                const backgroundColorValue = styleResults.styles['background-color'];
                if (backgroundColorValue) {
                    const bgColorSlug = mapColorToPaletteSlug(backgroundColorValue, globalThemeJsonData.settings.color.palette);
                    if (bgColorSlug) groupAttrs.backgroundColor = bgColorSlug;
                    else {
                        let classNameForBg = styleResults.generatedClassName;
                        if (!classNameForBg && !styleResults.directStyles?.['background-color']) {
                            customClassCounter++; classNameForBg = `custom-style-${customClassCounter}`;
                            groupAttrs.className = (groupAttrs.className || '') + ` ${classNameForBg}`;
                        }
                        if (classNameForBg) customCssRulesForStyleSheet.push(`.${classNameForBg.trim().split(' ').pop()} { background-color: ${backgroundColorValue}; }`);
                    }
                }
                const textColorValue = styleResults.styles['color'];
                if (textColorValue) {
                    const textColorSlug = mapColorToPaletteSlug(textColorValue, globalThemeJsonData.settings.color.palette);
                    if (textColorSlug) groupAttrs.textColor = textColorSlug;
                    else {
                        let classNameForColor = styleResults.generatedClassName;
                         if (!classNameForColor && !styleResults.directStyles?.['color']) {
                             customClassCounter++; classNameForColor = `custom-style-${customClassCounter}`;
                             groupAttrs.className = (groupAttrs.className || '') + ` ${classNameForColor}`;
                         }
                        if(classNameForColor) customCssRulesForStyleSheet.push(`.${classNameForColor.trim().split(' ').pop()} { color: ${textColorValue}; }`);
                    }
                }
                if (groupAttrs.className) groupAttrs.className = groupAttrs.className.trim();

                const divContent = await convertHtmlToBlockSyntax($element.html(), cssAst, 'fragment');
                const groupAttributeString = Object.keys(groupAttrs).length > 0 ? ` ${JSON.stringify(groupAttrs)}` : '';
                console.log(`DEBUG: Applying to ${blockName}: attributes ${JSON.stringify(groupAttrs)}`);
                $element.replaceWith(`<!-- wp:group${groupAttributeString} -->${divContent}<!-- /wp:group -->`);
                processed = true;
            }
            else if ($element.is('a') && !$element.parent().is('p, h1, h2, h3, h4, h5, h6, li')) {
                blockName = 'wp:paragraph';
                const pContent = await convertHtmlToBlockSyntax($.html($element), cssAst, 'fragment');
                console.log(`DEBUG: Applying to ${blockName} (wrapping 'a'): (content only)`);
                $element.replaceWith(`<!-- wp:paragraph -->${pContent}<!-- /wp:paragraph -->`);
                processed = true;
            }
        } // End of for...of loop

        console.log(`[[convertHtmlToBlockSyntax PRE_RETURN]] $root.html() final: "${$root.html()}"`);
        const outputHtml = isFragment ? $root.html() : $('body').html();
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
        if (['text-align', 'background-color', 'color'].includes(prop)) {
            // Handled by main block attribute mapping
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
        let processedContent = await convertHtmlToBlockSyntax(contentHtml, cssAst, 'fragment');

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
    return result.root;
  } catch (err) {
    console.error('Error loading or parsing CSS:', err.message);
    return null;
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
}

async function appendCustomStylesToStyleCss() {
  console.log(`INFO: Appending ${customCssRulesForStyleSheet.length} custom CSS rules to style.css.`);
  if (customCssRulesForStyleSheet.length === 0) return;

  const styleCssPath = path.join(baseOutputDir, 'style.css');
  const customStylesHeader = "\n\n/* Custom styles from converter */\n";
  try {
    let existingContent = '';
    try { existingContent = await fs.readFile(styleCssPath, 'utf8'); }
    catch (readError) { if (readError.code !== 'ENOENT') throw readError; }
    
    let contentToAppend = customCssRulesForStyleSheet.join('\n');
    if (existingContent && !existingContent.endsWith('\n')) contentToAppend = '\n' + contentToAppend;
    
    await fs.appendFile(styleCssPath, customStylesHeader + contentToAppend);
    console.log(`Appended ${customCssRulesForStyleSheet.length} custom style rules to ${styleCssPath}`);
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
