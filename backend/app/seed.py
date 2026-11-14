"""Insert the original sample Yankees/Red Sox records into the configured database."""

from datetime import datetime, timezone

from . import models
from .database import Base, SessionLocal, engine


def seed() -> None:
    """Create the schema and insert one example Yankees–Red Sox game."""
    # Ensure tables exist even when the seeder is run before starting the API.
    Base.metadata.create_all(bind=engine)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    # The transaction commits automatically when this context exits successfully.
    with SessionLocal.begin() as session:
        venue = models.Venue(providerId="v-1", name="Yankee Stadium", city="Bronx", state="NY")
        yankees = models.Team(providerId="t-147", name="New York Yankees", abbreviation="NYY", locationName="Bronx")
        red_sox = models.Team(providerId="t-111", name="Boston Red Sox", abbreviation="BOS", locationName="Boston")
        session.add_all([venue, yankees, red_sox])
        # Flush to generate team IDs before assigning them to player records.
        session.flush()
        session.add_all([
            models.Player(providerId="p-1", firstName="Aaron", lastName="Judge", fullName="Aaron Judge", position="RF", teamId=yankees.id),
            models.Player(providerId="p-2", firstName="Rafael", lastName="Devers", fullName="Rafael Devers", position="3B", teamId=red_sox.id),
            models.Game(providerId="g-1", venueId=venue.id, homeTeamId=yankees.id, awayTeamId=red_sox.id, status="Scheduled", scheduledStart=now),
        ])


if __name__ == "__main__":
    seed()
