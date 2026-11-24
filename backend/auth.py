import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

_proj = Path(__file__).resolve().parents[1]
_local_deps = _proj / "_pydeps"
if _local_deps.exists():
    sys.path.insert(0, str(_local_deps))

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.models import User

SECRET_KEY = os.getenv("SECRET_KEY", "change-me-in-production-32chars-minimum")
ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "1440"))

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login", auto_error=False)


def hash_password(password: str) -> str:
    if isinstance(password, str):
        password_bytes = password.encode("utf-8")
    else:
        password_bytes = password
    if len(password_bytes) > 72:
        password_bytes = password_bytes[:72]
    hashed = bcrypt.hashpw(password_bytes, bcrypt.gensalt(rounds=12))
    if isinstance(hashed, bytes):
        hashed = hashed.decode("utf-8")
    return hashed


def verify_password(plain_password: str, hashed_password: str) -> bool:
    if isinstance(plain_password, str):
        plain_bytes = plain_password.encode("utf-8")
    else:
        plain_bytes = plain_password
    if len(plain_bytes) > 72:
        plain_bytes = plain_bytes[:72]
    if isinstance(hashed_password, str):
        hashed_bytes = hashed_password.encode("utf-8")
    else:
        hashed_bytes = hashed_password
    try:
        return bool(bcrypt.checkpw(plain_bytes, hashed_bytes))
    except (ValueError, TypeError):
        return False


def create_access_token(
    subject: str | int,
    expires_delta: Optional[timedelta] = None,
) -> str:
    expire = datetime.now(timezone.utc) + (
        expires_delta if expires_delta else timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode = {"sub": str(subject), "exp": expire}
    encoded = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    if isinstance(encoded, bytes):
        encoded = encoded.decode("utf-8")
    return encoded


def get_current_user(
    token: Optional[str] = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not token:
        raise credentials_exception
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id_str: Optional[str] = payload.get("sub")
        if user_id_str is None:
            raise credentials_exception
        user_id = int(user_id_str)
    except (jwt.PyJWTError, ValueError):
        raise credentials_exception
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise credentials_exception
    return user
