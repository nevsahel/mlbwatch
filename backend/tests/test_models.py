from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from backend.app import models
from backend.app.database import Base


def test_models_support_basic_crud_and_unique_provider_event_id():
    engine = create_engine("sqlite+pysqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        venue = models.Venue(name="Test Venue")
        team = models.Team(name="Test Team")
        session.add_all([venue, team])
        session.flush()
        player = models.Player(firstName="John", lastName="Doe", teamId=team.id)
        session.add(player)
        session.flush()
        assert venue.id and team.id and player.teamId == team.id

        game = models.Game(status="Live")
        session.add(game)
        session.flush()
        session.add(models.GameEvent(providerEventId="event-123", gameId=game.id, type="strike"))
        session.commit()
        session.add(models.GameEvent(providerEventId="event-123", gameId=game.id, type="ball"))
        try:
            session.commit()
        except Exception:
            session.rollback()
        else:
            raise AssertionError("providerEventId must be unique")
    engine.dispose()
