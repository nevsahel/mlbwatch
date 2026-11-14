from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Float, ForeignKey, Integer, JSON, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def new_id() -> str:
    return str(uuid.uuid4())


class Timestamped:
    createdAt: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), nullable=False)
    updatedAt: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now(), nullable=False)


class Venue(Timestamped, Base):
    __tablename__ = "Venues"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    providerId: Mapped[str | None] = mapped_column(String)
    name: Mapped[str | None] = mapped_column(String)
    city: Mapped[str | None] = mapped_column(String)
    state: Mapped[str | None] = mapped_column(String)
    games: Mapped[list[Game]] = relationship(back_populates="venue")


class Team(Timestamped, Base):
    __tablename__ = "Teams"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    providerId: Mapped[str | None] = mapped_column(String)
    name: Mapped[str | None] = mapped_column(String)
    abbreviation: Mapped[str | None] = mapped_column(String)
    locationName: Mapped[str | None] = mapped_column(String)
    players: Mapped[list[Player]] = relationship(back_populates="team")
    homeGames: Mapped[list[Game]] = relationship(back_populates="homeTeam", foreign_keys="Game.homeTeamId")
    awayGames: Mapped[list[Game]] = relationship(back_populates="awayTeam", foreign_keys="Game.awayTeamId")


class Player(Timestamped, Base):
    __tablename__ = "Players"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    providerId: Mapped[str | None] = mapped_column(String)
    firstName: Mapped[str | None] = mapped_column(String)
    lastName: Mapped[str | None] = mapped_column(String)
    fullName: Mapped[str | None] = mapped_column(String)
    position: Mapped[str | None] = mapped_column(String)
    teamId: Mapped[str | None] = mapped_column(ForeignKey("Teams.id"))
    team: Mapped[Team | None] = relationship(back_populates="players")


class Game(Timestamped, Base):
    __tablename__ = "Games"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    providerId: Mapped[str | None] = mapped_column(String)
    venueId: Mapped[str | None] = mapped_column(ForeignKey("Venues.id"))
    homeTeamId: Mapped[str | None] = mapped_column(ForeignKey("Teams.id"))
    awayTeamId: Mapped[str | None] = mapped_column(ForeignKey("Teams.id"))
    status: Mapped[str | None] = mapped_column(String)
    scheduledStart: Mapped[datetime | None] = mapped_column(DateTime)
    venue: Mapped[Venue | None] = relationship(back_populates="games")
    homeTeam: Mapped[Team | None] = relationship(back_populates="homeGames", foreign_keys=[homeTeamId])
    awayTeam: Mapped[Team | None] = relationship(back_populates="awayGames", foreign_keys=[awayTeamId])
    gameState: Mapped[GameState | None] = relationship(back_populates="game", uselist=False)
    events: Mapped[list[GameEvent]] = relationship(back_populates="game")


class GameState(Timestamped, Base):
    __tablename__ = "GameStates"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    gameId: Mapped[str | None] = mapped_column(ForeignKey("Games.id"), unique=True)
    scoreHome: Mapped[int | None] = mapped_column(Integer)
    scoreAway: Mapped[int | None] = mapped_column(Integer)
    inning: Mapped[int | None] = mapped_column(Integer)
    inningHalf: Mapped[str | None] = mapped_column(String)
    outs: Mapped[int | None] = mapped_column(Integer)
    balls: Mapped[int | None] = mapped_column(Integer)
    strikes: Mapped[int | None] = mapped_column(Integer)
    currentBatterId: Mapped[str | None] = mapped_column(ForeignKey("Players.id"))
    currentPitcherId: Mapped[str | None] = mapped_column(ForeignKey("Players.id"))
    runnerOnFirstId: Mapped[str | None] = mapped_column(ForeignKey("Players.id"))
    runnerOnSecondId: Mapped[str | None] = mapped_column(ForeignKey("Players.id"))
    runnerOnThirdId: Mapped[str | None] = mapped_column(ForeignKey("Players.id"))
    game: Mapped[Game | None] = relationship(back_populates="gameState")


class GameEvent(Timestamped, Base):
    __tablename__ = "GameEvents"
    __table_args__ = (UniqueConstraint("providerEventId", name="uq_game_events_provider_event_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    providerEventId: Mapped[str | None] = mapped_column(String)
    gameId: Mapped[str | None] = mapped_column(ForeignKey("Games.id"))
    type: Mapped[str | None] = mapped_column(String)
    timestamp: Mapped[datetime | None] = mapped_column(DateTime)
    inning: Mapped[int | None] = mapped_column(Integer)
    description: Mapped[str | None] = mapped_column(Text)
    relevantPlayers: Mapped[Any | None] = mapped_column(JSON)
    relevantTeams: Mapped[Any | None] = mapped_column(JSON)
    game: Mapped[Game | None] = relationship(back_populates="events")


class Lineup(Timestamped, Base):
    __tablename__ = "Lineups"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    gameId: Mapped[str | None] = mapped_column(ForeignKey("Games.id"))
    teamId: Mapped[str | None] = mapped_column(ForeignKey("Teams.id"))
    playerId: Mapped[str | None] = mapped_column(ForeignKey("Players.id"))
    battingOrder: Mapped[int | None] = mapped_column(Integer)
    position: Mapped[str | None] = mapped_column(String)


class PlayerStatistic(Timestamped, Base):
    __tablename__ = "PlayerStatistics"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    playerId: Mapped[str | None] = mapped_column(ForeignKey("Players.id"))
    gameId: Mapped[str | None] = mapped_column(ForeignKey("Games.id"))
    category: Mapped[str | None] = mapped_column(String)
    value: Mapped[float | None] = mapped_column(Float)


class TeamStatistic(Timestamped, Base):
    __tablename__ = "TeamStatistics"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    teamId: Mapped[str | None] = mapped_column(ForeignKey("Teams.id"))
    gameId: Mapped[str | None] = mapped_column(ForeignKey("Games.id"))
    category: Mapped[str | None] = mapped_column(String)
    value: Mapped[float | None] = mapped_column(Float)


class Prediction(Timestamped, Base):
    __tablename__ = "Predictions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    gameId: Mapped[str | None] = mapped_column(ForeignKey("Games.id"))
    modelVersion: Mapped[str | None] = mapped_column(String)
    timestamp: Mapped[datetime | None] = mapped_column(DateTime)
    eventId: Mapped[str | None] = mapped_column(ForeignKey("GameEvents.id"))
    modelOutput: Mapped[Any | None] = mapped_column(JSON)
    probabilities: Mapped[Any | None] = mapped_column(JSON)
