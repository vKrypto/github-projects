from typing import Literal
from pydantic import BaseModel, EmailStr, Field, ConfigDict

class Signup(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: EmailStr
    password: str = Field(default='', max_length=128)

class Login(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)

class Profile(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: EmailStr
    focus: list[Literal['Physique','Overall wellness','Skin care','Hair care']] = Field(min_length=1)
    body_areas: list[str] = Field(default_factory=list, max_length=12)
    custom_area: str = Field(default='', max_length=300)
    diet: list[Literal['Vegetarian','Vegan','Gluten-free','Dairy-free']] = Field(default_factory=list)
    allergies: str = Field(default='', max_length=500)
    weight: float = Field(ge=30, le=350)
    height: float = Field(ge=100, le=250)
    age: int = Field(ge=18, le=100)
    level: Literal['Beginner','Intermediate','Advanced'] = 'Beginner'
    goal: Literal['Build muscle','Maintain & feel better','Lose fat'] = 'Maintain & feel better'
    skin_type: str = Field(default='', max_length=80)
    hair_type: str = Field(default='', max_length=80)
    care_early: bool = False
    equipment: str = Field(default='', max_length=1000)
    limitations: str = Field(default='', max_length=1000)
    notifications: bool = True
    timezone: str = 'Asia/Kolkata'

class TaskStatus(BaseModel):
    date: str
    task_id: str
    status: Literal['pending','completed','skipped']

class CheckIn(BaseModel):
    date: str
    water: int = Field(ge=0, le=20)
    weight: float | None = Field(default=None, ge=30, le=350)
    notes: str = Field(default='', max_length=2000)

class Feedback(BaseModel):
    text: str = Field(min_length=1, max_length=4000)

class PasswordChange(BaseModel):
    password: str = Field(min_length=8, max_length=128)

class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid')

class PlannedTask(StrictModel):
    time: str
    title: str
    description: str
    category: Literal['Workout','Breakfast','Lunch','Dinner','Snack','Skin care','Hair care']
    minutes: int
    calories: int
    ingredients: list[str]
    steps: list[str]

class TemplateDay(StrictModel):
    day: int
    tasks: list[PlannedTask]

class RolePlan(StrictModel):
    summary: str
    daily_calorie_target: int
    daily_burn_target: int
    weekly_progression: list[str]
    assumptions: list[str]
    days: list[TemplateDay]

class ReviewIssue(StrictModel):
    role: Literal['workout','meal','care']
    major: bool
    feedback: str

class PlanReview(StrictModel):
    approved: bool
    summary: str
    issues: list[ReviewIssue]
