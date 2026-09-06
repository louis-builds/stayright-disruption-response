using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TravelDisruptionAgent.Api.Migrations
{
    /// <inheritdoc />
    public partial class AddEscalationReview : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "escalation_review_note",
                table: "cases",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "escalation_reviewed_as_reasonable",
                table: "cases",
                type: "boolean",
                nullable: true);

            migrationBuilder.AddColumn<DateTimeOffset>(
                name: "escalation_reviewed_at",
                table: "cases",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<Guid>(
                name: "escalation_reviewed_by_user_id",
                table: "cases",
                type: "uuid",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "escalation_review_note",
                table: "cases");

            migrationBuilder.DropColumn(
                name: "escalation_reviewed_as_reasonable",
                table: "cases");

            migrationBuilder.DropColumn(
                name: "escalation_reviewed_at",
                table: "cases");

            migrationBuilder.DropColumn(
                name: "escalation_reviewed_by_user_id",
                table: "cases");
        }
    }
}
