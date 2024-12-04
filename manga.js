// Add this inside the <script> tags of the anime.html file

document.addEventListener('DOMContentLoaded', () => {
    // Global variables
    let currentPage = 1;
    let currentAnimeList = [];
    const animeContainer = document.getElementById('anime-container');
    const modal = document.getElementById('anime-modal');
    const searchInput = document.querySelector('.search-bar input');
    const genreFilter = document.getElementById('genre-filter');
    const seasonFilter = document.getElementById('season-filter');
    const sortFilter = document.getElementById('sort-filter');

    // Fetch anime data from API
    async function fetchAnime(page = 1) {
        try {
            animeContainer.innerHTML = '<div class="loading">Loading anime...</div>';
            
            // Using Jikan API
            const response = await fetch(`https://api.jikan.moe/v4/anime?page=${page}&limit=24`);
            const data = await response.json();
            
            displayAnime(data.data);
            setupPagination(data.pagination);
            currentAnimeList = data.data;
        } catch (error) {
            animeContainer.innerHTML = '<div class="error">Error loading anime. Please try again later.</div>';
            console.error('Error:', error);
        }
    }

    // Display anime in grid
    function displayAnime(animeList) {
        animeContainer.innerHTML = '';
        
        animeList.forEach(anime => {
            const card = document.createElement('div');
            card.className = 'anime-card';
            card.innerHTML = `
                <img src="${anime.images.jpg.large_image_url}" alt="${anime.title}">
                <div class="anime-info">
                    <h3 class="anime-title">${anime.title}</h3>
                    <div class="anime-meta">
                        <span>${anime.episodes || '?'} Episodes</span>
                        <div class="anime-rating">
                            <i class="fas fa-star"></i>
                            <span>${anime.score || 'N/A'}</span>
                        </div>
                    </div>
                </div>
            `;
            
            // Add click event for modal
            card.addEventListener('click', () => showAnimeDetails(anime));
            animeContainer.appendChild(card);
        });
    }

    // Show anime details in modal
    async function showAnimeDetails(anime) {
        try {
            // Fetch additional details including episodes
            const response = await fetch(`https://api.jikan.moe/v4/anime/${anime.mal_id}/episodes`);
            const episodeData = await response.json();
            
            modal.style.display = 'block';
            modal.querySelector('.modal-content').innerHTML = `
                <div class="modal-header">
                    <h2>${anime.title}</h2>
                    <span class="close-modal">&times;</span>
                </div>
                <div class="modal-body">
                    <div class="anime-details">
                        <img src="${anime.images.jpg.large_image_url}" alt="${anime.title}">
                        <div class="details-info">
                            <p><strong>Rating:</strong> ${anime.score || 'N/A'}</p>
                            <p><strong>Episodes:</strong> ${anime.episodes || 'TBA'}</p>
                            <p><strong>Status:</strong> ${anime.status}</p>
                            <p><strong>Genre:</strong> ${anime.genres.map(g => g.name).join(', ')}</p>
                            <p>${anime.synopsis}</p>
                        </div>
                    </div>
                    <h3>Episodes</h3>
                    <div class="episode-list">
                        ${episodeData.data.map(ep => `
                            <div class="episode-item">
                                <span class="episode-number">Episode ${ep.mal_id}</span>
                                <span class="episode-title">${ep.title}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;

            // Close modal event
            modal.querySelector('.close-modal').onclick = () => {
                modal.style.display = 'none';
            };
        } catch (error) {
            console.error('Error loading episode details:', error);
        }
    }

    // Setup pagination
    function setupPagination(paginationData) {
        const paginationContainer = document.getElementById('pagination');
        const totalPages = paginationData.last_visible_page;
        
        let paginationHTML = '';
        
        // Previous button
        paginationHTML += `
            <button ${currentPage === 1 ? 'disabled' : ''} 
                    onclick="changePage(${currentPage - 1})">
                Previous
            </button>
        `;
        
        // Page numbers
        for (let i = Math.max(1, currentPage - 2); i <= Math.min(totalPages, currentPage + 2); i++) {
            paginationHTML += `
                <button class="${i === currentPage ? 'active' : ''}" 
                        onclick="changePage(${i})">
                    ${i}
                </button>
            `;
        }
        
        // Next button
        paginationHTML += `
            <button ${currentPage === totalPages ? 'disabled' : ''} 
                    onclick="changePage(${currentPage + 1})">
                Next
            </button>
        `;
        
        paginationContainer.innerHTML = paginationHTML;
    }

    // Change page
    window.changePage = (page) => {
        currentPage = page;
        fetchAnime(page);
        window.scrollTo(0, 0);
    };

    // Search functionality
    searchInput.addEventListener('input', debounce(() => {
        const searchTerm = searchInput.value.toLowerCase();
        if (searchTerm) {
            const filteredAnime = currentAnimeList.filter(anime => 
                anime.title.toLowerCase().includes(searchTerm)
            );
            displayAnime(filteredAnime);
        } else {
            fetchAnime(currentPage);
        }
    }, 300));

    // Filter change handlers
    [genreFilter, seasonFilter, sortFilter].forEach(filter => {
        filter.addEventListener('change', () => {
            currentPage = 1;
            fetchAnime(currentPage);
        });
    });

    // Utility function for debouncing
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // Close modal when clicking outside
    window.onclick = (event) => {
        if (event.target === modal) {
            modal.style.display = 'none';
        }
    };

    // Initial load
    fetchAnime();
});