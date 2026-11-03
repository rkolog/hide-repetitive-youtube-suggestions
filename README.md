# Hide Repetitive YouTube Suggestions

Firefox extension that hides YouTube home page and video page suggestions
once they've appeared more times than the limit set by the user.

## Features
- Counts recommendations in YouTube **Home Feed** or a **Watch Page** sidebar, stores their video IDs, hides repetitive suggestions.
- Configurable appearance threshold
- Optional expiry, videos start reappearing after user-set number of days. (Using expiry feature is recommended against data accumulation. Otherwise, clearing history is recommended in case lags happen)
- Toggle to reveal hidden videos
- DEBUG is available for developers to log and inspect actions (enable in content.js)
- It depends on web page elements of YouTube, it may become unusable when YouTube's frontend and format of related elements become updated

## Permissions

This extension requires minimal permissions to protect your privacy and ensure lightweight operation:

- Access to www.youtube.com data is needed to scan and modify the page elements
- Access for storing data in local browser storage is needed to remember tracked videos across sessions.

All data is only kept in local browser storage, never sent to anywhere else or collected, clearing browser cache will result with loss of data.

## Roadmap & Planned Features

Contributions are welcomed. My personally planned features for future:

- Support to flag videos as "NeverHide", they won't become hidden even if they breach the appearance threshold (planned as a button on video cards)

## License

This project is open-source software. Feel free to modify and distribute as needed. Intended to work with YouTube desktop webpage, not affiliated or officially connected to YouTube, Google LLC or Alphabet Inc.
