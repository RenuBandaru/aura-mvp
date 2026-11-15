"""Shared test setup: every test starts with the sample people, whatever an earlier test imported."""

import pytest

from aura_engine import constants


@pytest.fixture(autouse=True)
def sample_people():
    constants.use_people(constants.sample_people())
    yield
    constants.use_people(constants.sample_people())
