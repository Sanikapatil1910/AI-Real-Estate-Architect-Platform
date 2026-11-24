"""Upload validation: type (by content, not by file name), size and pixel limits.  Nothing here logs or keeps the image."""
from __future__ import annotations

import os
from dataclasses import dataclass
from io import BytesIO

ALLOWED = {"image/png": "PNG", "image/jpeg": "JPEG"}
SIGNATURES = (("image/png", b"\x89PNG\r\n\x1a\n"), ("image/jpeg", b"\xff\xd8\xff"))
MIN_SIDE_PX = 200
MAX_PIXELS = 60_000_000


class UploadError(Exception):
    """A problem the user can fix; `code` is stable for the front end, `message` is plain language."""

    def __init__(self, code: str, message: str, status: int = 422):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


def max_bytes() -> int:
    try:
        mb = float(os.getenv("PLAN_UPLOAD_MAX_MB", "10"))
    except ValueError:
        mb = 10.0
    return int(max(0.5, min(mb, 14.0)) * 1024 * 1024)     # Gemini's inline request limit is 20 MB in total (base64 adds a third)


@dataclass(frozen=True)
class ImageInfo:
    mime: str
    width: int
    height: int
    size: int


def sniff(data: bytes) -> str | None:
    for mime, sig in SIGNATURES:
        if data.startswith(sig):
            return mime
    return None


def validate_image(data: bytes, declared_mime: str | None = None) -> ImageInfo:
    if not data:
        raise UploadError("empty_file", "The file is empty.")
    if data[:5] == b"%PDF-":
        raise UploadError("pdf_not_supported", "PDF plans are not supported yet because a PDF can hide scripts and many pages; export the plan page as PNG or JPG and upload that.", 415)
    if len(data) > max_bytes():
        raise UploadError("too_large", f"The image is {len(data) / 1048576:.1f} MB; the limit is {max_bytes() / 1048576:.0f} MB.", 413)
    mime = sniff(data)
    if mime is None:
        raise UploadError("bad_type", "Only PNG or JPG/JPEG images can be read. The file's content is not one of those.", 415)
    if declared_mime and declared_mime.lower() in ("image/jpg",):
        declared_mime = "image/jpeg"
    if declared_mime and declared_mime.lower() in ALLOWED and declared_mime.lower() != mime:
        raise UploadError("type_mismatch", "The file's type does not match its content.", 415)
    try:
        from PIL import Image, ImageFile
        Image.MAX_IMAGE_PIXELS = MAX_PIXELS
        ImageFile.LOAD_TRUNCATED_IMAGES = False
        with Image.open(BytesIO(data)) as im:
            width, height = im.size
            im.verify()
    except UploadError:
        raise
    except Exception:
        raise UploadError("corrupt", "The image could not be opened; it may be damaged or incomplete.")
    if min(width, height) < MIN_SIDE_PX:
        raise UploadError("too_small", f"The image is only {width} x {height} px; a plan needs at least {MIN_SIDE_PX} px on each side to be readable.")
    if width * height > MAX_PIXELS:
        raise UploadError("too_many_pixels", "The image has too many pixels; export it at a smaller size.")
    return ImageInfo(mime=mime, width=width, height=height, size=len(data))
