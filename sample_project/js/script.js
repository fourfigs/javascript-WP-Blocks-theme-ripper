console.log("Sample project script loaded.");

document.addEventListener('DOMContentLoaded', function() {
    const navLinks = document.querySelectorAll('nav ul li a');
    navLinks.forEach(function(link) {
        if (link.href === window.location.href) {
            link.style.fontWeight = 'bold';
            link.style.textDecoration = 'underline';
        }
    });
});
