import enum
from datetime import datetime

from sqlalchemy import Column, DateTime, Enum, ForeignKey, Integer, String, Text

from backend.database import Base


class UserRole(str, enum.Enum):
    home_owner = "home_owner"
    architect = "architect"
    civil_engineer = "civil_engineer"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    full_name = Column(String, nullable=False)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    role = Column(Enum(UserRole), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class Project(Base):
    """A saved design: either a generated plan (request + plan) or an uploaded-plan model (draft + plan).  `data` is JSON text."""
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    name = Column(String(120), nullable=False)
    kind = Column(String(16), nullable=False, default="generated")      # "generated" | "upload"
    style = Column(String(40), nullable=False, default="Modern Minimalistic")
    summary = Column(Text, nullable=False, default="{}")                # small JSON for list views (rooms, floors, plot ...)
    data = Column(Text, nullable=False, default="{}")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
