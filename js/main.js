document.addEventListener('DOMContentLoaded', function() {
    // Sticky Header
    const header = document.querySelector('.sticky-header');
    const topBar = document.querySelector('.top-bar');
    let lastScroll = 0;

    window.addEventListener('scroll', function() {
        const currentScroll = window.pageYOffset;
        
        // Add sticky class to header when scrolling past top bar
        if (currentScroll > topBar.offsetHeight) {
            header.classList.add('sticky');
        } else {
            header.classList.remove('sticky');
        }
        
        lastScroll = currentScroll;
    });

    // Back to Top Button
    const backToTop = document.querySelector('.back-to-top');
    const backToTopButton = document.querySelector('.back-to-top-button');

    window.addEventListener('scroll', function() {
        if (window.pageYOffset > 300) {
            backToTop.classList.add('show');
        } else {
            backToTop.classList.remove('show');
        }
    });

    backToTopButton.addEventListener('click', function(e) {
        e.preventDefault();
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    });
}); 