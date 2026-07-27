import os
import re
import tempfile
from pathlib import Path
from typing import Optional

import requests
from tqdm import tqdm


HEADERS = {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1"
}


def parse_share_url(share_text: str) -> dict:
    # Extract first URL from the input text
    url_match = re.search(r"https?://[^\s]+", share_text)
    if not url_match:
        raise ValueError("No URL found in the provided text.")
    share_url = url_match.group(0)

    # Fetch the share page
    response = requests.get(share_url, headers=HEADERS, timeout=15)
    response.raise_for_status()

    # Extract the JSON data embedded in the page
    json_match = re.search(r"window\._ROUTER_DATA\s*=\s*(\{.*\})", response.text, re.DOTALL)
    if not json_match:
        raise ValueError("Could not locate window._ROUTER_DATA in the page source.")
    json_text = json_match.group(1)
    try:
        data = eval(json_text)  # Simplified; in production use json.loads
    except Exception as e:
        raise ValueError(f"Failed to parse JSON data: {e}")

    # Determine video identifier and fetch video info
    video_id = None
    for key in data:
        if key.startswith("video_") or key.startswith("note_"):
            video_id = key.split("_", 1)[1]
            break
    if not video_id:
        raise ValueError("Could not find video identifier in the JSON data.")

    # Extract video metadata
    video_info = data.get("video", {}).get("item_list", [{}])[0]
    title = video_info.get("desc", "").strip()
    if not title:
        title = f"douyin_{video_id}"
    # Get the play address (may contain watermark)
    play_addr = video_info.get("play_addr", {})
    url_list = play_addr.get("url_list", [])
    if not url_list:
        raise ValueError("No video URL found in play_addr.")
    video_url_with_watermark = url_list[0]

    # Remove watermark by replacing 'playwm' with 'play'
    video_url = video_url_with_watermark.replace("playwm", "play")
    return {
        "video_id": video_id,
        "title": title,
        "video_url": video_url,
    }


def download_video(
    video_info: dict,
    output_dir: Optional[Path] = None,
    show_progress: bool = True,
) -> Path:
    # Determine output directory
    if output_dir is None:
        output_dir = Path(tempfile.mkdtemp(prefix="douyin_video_"))
    else:
        output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    video_id = video_info["video_id"]
    video_url = video_info["video_url"]
    file_path = output_dir / f"{video_id}.mp4"

    # Download the video
    response = requests.get(video_url, headers=HEADERS, stream=True, timeout=30)
    response.raise_for_status()

    total_size = int(response.headers.get("content-length", 0))
    chunk_size = 8192

    with open(file_path, "wb") as f, tqdm(
        total=total_size,
        unit="iB",
        unit_scale=True,
        unit_divisor=1024,
        desc=f"Downloading {video_id}",
        disable=not show_progress,
    ) as bar:
        for chunk in response.iter_content(chunk_size=chunk_size):
            f.write(chunk)
            bar.update(len(chunk))

    return file_path


def download_douyin_video(
    share_text: str,
    output_dir: Optional[Path] = None,
    show_progress: bool = True,
    api_key: Optional[str] = None,
) -> Path:
    """
    Parse a Douyin share link/text, extract the video URL, and download the video.

    Args:
        share_text: The raw share text or URL containing the Douyin link.
        output_dir: Directory to save the video. Defaults to a temporary folder.
        show_progress: Whether to display a tqdm progress bar.
        api_key: Optional API key for future extensions (e.g., extracting subtitles).

    Returns:
        Path to the downloaded video file.
    """
    video_info = parse_share_url(share_text)
    return download_video(video_info, output_dir=output_dir, show_progress=show_progress)


if __name__ == "__main__":
    # Simple CLI for testing
    import argparse
    parser = argparse.ArgumentParser(description="Download Douyin video without watermark")
    parser.add_argument("--link", required=True, help="Douyin share link or text containing the link")
    parser.add_argument("--output", default="./output", help="Output directory")
    parser.add_argument("--no-progress", action="store_true", help="Disable progress bar")
    args = parser.parse_args()

    try:
        path = download_douyin_video(
            share_text=args.link,
            output_dir=args.output,
            show_progress=not args.no_progress,
        )
        print(f"Video saved to: {path}")
    except Exception as e:
        print(f"Error: {e}")