# CLAUDE.md — AI Assistant Guide for AIRepo

## Repository Overview

AIRepo is a newly initialized project repository. It currently contains only a README.md and is ready for initial development.

- **Owner**: satmakuru222
- **Created**: September 2025

## Current State

This is a greenfield project with no source code, build system, or infrastructure set up yet. The repository is at the earliest stage of development.

### File Structure

```
AIRepo/
├── CLAUDE.md        # This file — guidance for AI assistants
└── README.md        # Project description (minimal)
```

## Development Workflow

### Git Conventions

- **Default branch**: `main`
- **Feature branches**: Use descriptive branch names (e.g., `feature/add-auth`, `fix/login-bug`)
- **Commit messages**: Write clear, imperative-mood messages (e.g., "Add user authentication module")
- Keep commits atomic — one logical change per commit

### When Adding New Infrastructure

As the project grows, update this file to reflect:

1. **Language/framework chosen** and version requirements
2. **How to install dependencies** (e.g., `npm install`, `pip install -r requirements.txt`)
3. **How to build** the project
4. **How to run tests** and what test framework is used
5. **How to lint/format** code
6. **Environment variables** or configuration needed
7. **Project architecture** and key directories

## Conventions for AI Assistants

### General Rules

- Read existing code before making changes — understand context first
- Keep changes minimal and focused on the task at hand
- Do not over-engineer; solve the immediate problem
- Do not add unnecessary abstractions, comments, or type annotations to unchanged code
- Avoid introducing security vulnerabilities (injection, XSS, etc.)
- Prefer editing existing files over creating new ones

### Code Quality

- Follow whatever language-specific style is established in the codebase
- Match existing patterns and conventions rather than introducing new ones
- Write tests for new functionality when a test framework is present
- Do not add dead code, commented-out code, or placeholder TODO comments

### Documentation

- Update this CLAUDE.md when significant infrastructure or architectural decisions are made
- Keep README.md current with setup instructions as the project evolves
- Do not create extra documentation files unless explicitly requested

## Quick Reference

| Task | Command |
|------|---------|
| Check repo status | `git status` |
| View recent history | `git log --oneline -10` |

*Update this table as build/test/lint commands are established.*
