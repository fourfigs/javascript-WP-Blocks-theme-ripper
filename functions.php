<?php
/**
 * NMERA Blocks functions and definitions
 */

if (!defined('ABSPATH')) {
    exit; // Exit if accessed directly
}

/**
 * Enqueue theme assets
 */
function nmera_blocks_enqueue_assets() {
    // Enqueue Google Fonts
    wp_enqueue_style(
        'nmera-google-fonts',
        'https://fonts.googleapis.com/css2?family=Jost:wght@500;600;700&family=Open+Sans:wght@400;500&display=swap',
        array(),
        null
    );

    // Enqueue Font Awesome
    wp_enqueue_style(
        'font-awesome',
        'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.10.0/css/all.min.css',
        array(),
        '5.10.0'
    );

    // Enqueue Bootstrap Icons
    wp_enqueue_style(
        'bootstrap-icons',
        'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.4.1/font/bootstrap-icons.css',
        array(),
        '1.4.1'
    );

    // Enqueue main JavaScript file
    wp_enqueue_script(
        'nmera-blocks-main',
        get_theme_file_uri('js/main.js'),
        array(),
        '1.0.0',
        true
    );
}
add_action('wp_enqueue_scripts', 'nmera_blocks_enqueue_assets');

/**
 * Register block patterns
 */
function nmera_blocks_register_patterns() {
    if (function_exists('register_block_pattern')) {
        // Hero Pattern
        register_block_pattern(
            'nmera-blocks/hero',
            array(
                'title' => __('NMERA Hero Section', 'nmera-blocks'),
                'description' => __('A hero section with oval effect and call-to-action button', 'nmera-blocks'),
                'categories' => array('nmera-blocks'),
                'content' => '<!-- wp:group {"className":"wp-block-nmera-hero","layout":{"type":"constrained"}} -->
<div class="wp-block-group wp-block-nmera-hero">
    <!-- wp:cover {"url":"' . get_theme_file_uri('assets/images/header2.jpeg') . '","dimRatio":50,"minHeight":750,"className":"hero-cover"} -->
    <div class="wp-block-cover hero-cover" style="min-height:750px">
        <span aria-hidden="true" class="wp-block-cover__background has-background-dim"></span>
        <img class="wp-block-cover__image-background" alt="" src="' . get_theme_file_uri('assets/images/header2.jpeg') . '" data-object-fit="cover"/>
        <div class="wp-block-cover__inner-container">
            <!-- wp:heading {"textAlign":"left","level":1,"textColor":"white","className":"hero-title"} -->
            <h1 class="wp-block-heading has-text-align-left hero-title">Revitalizing our ecosystems by empowering our community.</h1>
            <!-- /wp:heading -->

            <!-- wp:buttons {"layout":{"type":"flex","justifyContent":"left"}} -->
            <div class="wp-block-buttons">
                <!-- wp:button {"backgroundColor":"primary","textColor":"white","className":"hero-btn"} -->
                <div class="wp-block-button hero-btn">
                    <a class="wp-block-button__link has-white-color has-primary-background-color has-text-color has-background wp-element-button">Donate Now</a>
                </div>
                <!-- /wp:button -->
            </div>
            <!-- /wp:buttons -->
        </div>
    </div>
    <!-- /wp:cover -->
</div>
<!-- /wp:group -->'
            )
        );

        // About Section Pattern
        register_block_pattern(
            'nmera-blocks/about',
            array(
                'title' => __('NMERA About Section', 'nmera-blocks'),
                'description' => __('About section with image and text', 'nmera-blocks'),
                'categories' => array('nmera-blocks'),
                'content' => '<!-- wp:group {"className":"about-section","layout":{"type":"constrained"}} -->
<div class="wp-block-group about-section">
    <!-- wp:columns {"verticalAlignment":"center"} -->
    <div class="wp-block-columns are-vertically-aligned-center">
        <!-- wp:column {"width":"40%"} -->
        <div class="wp-block-column" style="flex-basis:40%">
            <!-- wp:image {"sizeSlug":"large","linkDestination":"none"} -->
            <figure class="wp-block-image size-large">
                <img src="' . get_theme_file_uri('assets/images/jess2.jpg') . '" alt="NM-ERA"/>
            </figure>
            <!-- /wp:image -->
        </div>
        <!-- /wp:column -->

        <!-- wp:column {"width":"60%"} -->
        <div class="wp-block-column" style="flex-basis:60%">
            <!-- wp:heading {"textColor":"primary"} -->
            <h2 class="wp-block-heading has-primary-color has-text-color">Experience</h2>
            <!-- /wp:heading -->

            <!-- wp:heading {"level":3} -->
            <h3 class="wp-block-heading">A little about us</h3>
            <!-- /wp:heading -->

            <!-- wp:paragraph -->
            <p>Welcome to the Northern Mendocino Ecosystem Recovery Alliance (NM-ERA). Through direct action and community education, we restore and protect the health of our local forests, enhance fire resilience, and build a sustainable, regenerative future.</p>
            <!-- /wp:paragraph -->

            <!-- wp:buttons -->
            <div class="wp-block-buttons">
                <!-- wp:button {"backgroundColor":"primary","textColor":"white"} -->
                <div class="wp-block-button">
                    <a class="wp-block-button__link has-white-color has-primary-background-color has-text-color has-background wp-element-button">Our Mission</a>
                </div>
                <!-- /wp:button -->
            </div>
            <!-- /wp:buttons -->
        </div>
        <!-- /wp:column -->
    </div>
    <!-- /wp:columns -->
</div>
<!-- /wp:group -->'
            )
        );
    }
}
add_action('init', 'nmera_blocks_register_patterns');

/**
 * Register block pattern categories
 */
function nmera_blocks_register_pattern_categories() {
    if (function_exists('register_block_pattern_category')) {
        register_block_pattern_category(
            'nmera-blocks',
            array('label' => __('NMERA Blocks', 'nmera-blocks'))
        );
    }
}
add_action('init', 'nmera_blocks_register_pattern_categories');

/**
 * Add theme support
 */
function nmera_blocks_setup() {
    // Add support for full and wide alignments
    add_theme_support('align-wide');

    // Add support for responsive embeds
    add_theme_support('responsive-embeds');

    // Add support for custom logo
    add_theme_support('custom-logo', array(
        'height'      => 100,
        'width'       => 400,
        'flex-height' => true,
        'flex-width'  => true,
    ));

    // Add support for post thumbnails
    add_theme_support('post-thumbnails');

    // Add support for editor styles
    add_theme_support('editor-styles');

    // Add support for custom units
    add_theme_support('custom-units', array('px', 'em', 'rem', 'vh', 'vw', '%'));
}
add_action('after_setup_theme', 'nmera_blocks_setup'); 