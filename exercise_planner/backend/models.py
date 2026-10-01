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
    time: str = Field(pattern=r'^(?:[01][0-9]|2[0-3]):[0-5][0-9]$')
    title: str
    description: str
    category: Literal['Workout','Breakfast','Lunch','Dinner','Snack','Skin care','Hair care']
    minutes: int = Field(ge=0, le=120)
    calories: int = Field(ge=0, le=2000)
    ingredients: list[str]
    steps: list[str] = Field(min_length=1, max_length=12)

class TemplateDay(StrictModel):
    day: int = Field(ge=1, le=7)
    tasks: list[PlannedTask] = Field(min_length=1, max_length=10)

class RolePlan(StrictModel):
    summary: str
    daily_calorie_target: int
    daily_burn_target: int
    weekly_progression: list[str] = Field(min_length=4, max_length=4)
    assumptions: list[str]
    days: list[TemplateDay] = Field(min_length=7, max_length=7)

class ReviewIssue(StrictModel):
    role: Literal['workout','meal','care']
    major: bool
    feedback: str

class PlanReview(StrictModel):
    approved: bool
    summary: str
    issues: list[ReviewIssue]


class WorkoutTask(PlannedTask):
    category: Literal['Workout']

class MealTask(PlannedTask):
    category: Literal['Breakfast','Lunch','Dinner','Snack']

class CareTask(PlannedTask):
    category: Literal['Skin care','Hair care']
    calories: int = Field(ge=0, le=0)

class WorkoutDay(TemplateDay):
    tasks: list[WorkoutTask] = Field(min_length=1, max_length=10)

class MealDay(TemplateDay):
    tasks: list[MealTask] = Field(min_length=3, max_length=6)

class CareDay(TemplateDay):
    tasks: list[CareTask] = Field(min_length=1, max_length=8)

class WorkoutPlan(RolePlan):
    daily_calorie_target: int = Field(ge=0, le=0)
    daily_burn_target: int = Field(ge=0, le=2000)
    days: list[WorkoutDay] = Field(min_length=7, max_length=7)

class MealPlan(RolePlan):
    daily_calorie_target: int = Field(ge=1400, le=5000)
    daily_burn_target: int = Field(ge=0, le=0)
    days: list[MealDay] = Field(min_length=7, max_length=7)

class CarePlan(RolePlan):
    daily_calorie_target: int = Field(ge=0, le=0)
    daily_burn_target: int = Field(ge=0, le=0)
    days: list[CareDay] = Field(min_length=7, max_length=7)
