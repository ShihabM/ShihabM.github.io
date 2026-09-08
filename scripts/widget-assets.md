# Home Screen widget artwork

Exported September 8, 2026 from Binge's iPhone SwiftUI widget source in the sibling `Reel/ReelWidgets` project:

- `MovieWatchlistWidget.swift`: SmallViewMovies, MediumViewMovies, LargeViewMovies
- `ShowWatchlistWidget.swift`: SmallViewShows, MediumViewShows, LargeViewShows
- `YourNextMovieWidget.swift`: YUSmallViewMovies, YUMediumViewMovies, YULargeViewMovies

The source views were rendered by a temporary iOS app on the iPhone 17 Pro simulator using SwiftUI ImageRenderer, light color scheme, en_US locale, 16-point widget margins, white backgrounds, 24-point continuous corners, and 3× scale. Sizes: 170×170, 364×170, and 364×364 points. The poster loader used bundled TMDB artwork instead of synchronous network requests. The widget layouts themselves were preserved. No changes were made to the iPhone app project or its user library.

Movie and show titles, release dates, IDs, and poster paths were retrieved through the website's existing public TMDB search proxy. Posters came from TMDB's w185 image service. Movie selection includes 2026 releases Spider-Man: Brand New Day, The Odyssey, Toy Story 5, Supergirl, The Devil Wears Prada 2, and Project Hail Mary. Shows include House of the Dragon, The Bear, Severance, Alien: Earth, Wednesday, and The Pitt. These are illustrative watchlists; the website does not label them as live charts or upcoming releases.

Small variants use different pairs of these titles. PNGs preserve native typography and transparent corners; website CSS supplies the outer shadows. To refresh, render the same views with updated TMDB items and replace the corresponding files in `assets/widgets`.
